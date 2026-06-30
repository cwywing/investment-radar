import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, closeDatabase } from '../db/database.js';
import {
  loadCandles,
  saveCandles,
  getLatestDate,
  loadFactors,
  saveFactors,
  getLatestFactorDate,
  clearCandles,
} from '../db/candles.js';
import type { Candle } from '../types.js';

afterEach(() => {
  closeDatabase();
});

function candle(date: string, close: number): Candle {
  return { date, open: close, high: close, low: close, close, volume: 100 };
}

test('candles CRUD: 空库 loadCandles 返回 []', () => {
  openDatabase(':memory:');
  assert.deepEqual(loadCandles('au9999'), []);
  assert.equal(getLatestDate('au9999'), null);
});

test('candles CRUD: saveCandles + loadCandles 往返,按 date 升序', () => {
  openDatabase(':memory:');
  saveCandles('au9999', [
    candle('2026-06-27', 880),
    candle('2026-06-26', 875),
    candle('2026-06-25', 870),
  ], 'eastmoney_gold');
  const loaded = loadCandles('au9999');
  assert.equal(loaded.length, 3);
  assert.equal(loaded[0].date, '2026-06-25');
  assert.equal(loaded[2].date, '2026-06-27');
  assert.equal(loaded[2].close, 880);
  assert.equal(getLatestDate('au9999'), '2026-06-27');
});

test('candles upsert: 同 date 覆盖(修正最新一两日)', () => {
  openDatabase(':memory:');
  saveCandles('au9999', [candle('2026-06-29', 888)], 'eastmoney_gold');
  // 增量抓到 06-29 修正价 + 06-30 新日
  saveCandles('au9999', [candle('2026-06-29', 890), candle('2026-06-30', 895)], 'eastmoney_gold');
  const loaded = loadCandles('au9999');
  assert.equal(loaded.length, 2);
  const d29 = loaded.find((c) => c.date === '2026-06-29');
  assert.equal(d29?.close, 890, '06-29 应被修正为 890');
  assert.equal(getLatestDate('au9999'), '2026-06-30');
});

test('candles 多资产隔离', () => {
  openDatabase(':memory:');
  saveCandles('au9999', [candle('2026-06-29', 888)], 'eastmoney_gold');
  saveCandles('fund-csi300', [candle('2026-06-29', 1.9)], 'eastmoney_fund');
  assert.equal(loadCandles('au9999').length, 1);
  assert.equal(loadCandles('fund-csi300').length, 1);
  assert.equal(loadCandles('au9999')[0].close, 888);
  assert.equal(loadCandles('fund-csi300')[0].close, 1.9);
});

test('candles clearCandles 清空指定资产,不影响其他', () => {
  openDatabase(':memory:');
  saveCandles('au9999', [candle('2026-06-29', 888)], 'eastmoney_gold');
  saveCandles('ag9999', [candle('2026-06-29', 8)], 'eastmoney_gold');
  clearCandles('au9999');
  assert.equal(loadCandles('au9999').length, 0);
  assert.equal(loadCandles('ag9999').length, 1);
});

test('factors CRUD: save + load + getLatest + upsert', () => {
  openDatabase(':memory:');
  assert.deepEqual(loadFactors('xau'), []);
  assert.equal(getLatestFactorDate('xau'), null);

  saveFactors('xau', [
    { date: '2026-06-26', close: 2300 },
    { date: '2026-06-25', close: 2290 },
  ]);
  const loaded = loadFactors('xau');
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].date, '2026-06-25');
  assert.equal(getLatestFactorDate('xau'), '2026-06-26');

  // upsert 修正 + 新增
  saveFactors('xau', [
    { date: '2026-06-26', close: 2305 },
    { date: '2026-06-29', close: 2320 },
  ]);
  const after = loadFactors('xau');
  assert.equal(after.length, 3);
  assert.equal(after.find((f) => f.date === '2026-06-26')?.close, 2305, '06-26 修正为 2305');
  assert.equal(getLatestFactorDate('xau'), '2026-06-29');
});

test('factors 多 series 隔离', () => {
  openDatabase(':memory:');
  saveFactors('xau', [{ date: '2026-06-29', close: 2300 }]);
  saveFactors('cnh', [{ date: '2026-06-29', close: 7.2 }]);
  saveFactors('dxy', [{ date: '2026-06-29', close: 105 }]);
  assert.equal(loadFactors('xau')[0].close, 2300);
  assert.equal(loadFactors('cnh')[0].close, 7.2);
  assert.equal(loadFactors('dxy')[0].close, 105);
});

test('saveCandles 空数组不报错(noop)', () => {
  openDatabase(':memory:');
  saveCandles('au9999', [], 'eastmoney_gold');
  assert.equal(loadCandles('au9999').length, 0);
});
