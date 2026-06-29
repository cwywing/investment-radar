import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIntraday, parseIntradayKlines, type IntradayBar } from '../data/goldIntraday.js';

function bar(dt: string, open: number, high: number, low: number, close: number, vol: number): IntradayBar {
  const m = dt.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/)!;
  return { dt, hour: Number(m[2]), minute: Number(m[3]), open, high, low, close, vol };
}

test('computeIntraday: 会话从最近 20:00 起,切到末尾(纯函数)', () => {
  // 构造:前一交易日 15:00 几根 + 本日 20:00 起 夜盘 + 次日 09:00 日盘
  const bars = [
    bar('2026-06-26 14:58', 880, 881, 879, 880, 10), // 上一会话末(应被切掉)
    bar('2026-06-26 15:00', 883.7, 884, 883, 883.7, 5),
    bar('2026-06-26 20:00', 883.7, 885, 883, 884, 20), // 本会话起点
    bar('2026-06-26 20:05', 884, 886, 884, 886, 30),
    bar('2026-06-26 23:00', 886, 887, 885, 885.5, 10),
    bar('2026-06-27 01:00', 885.5, 886, 885, 885, 8),   // 夜盘跨午夜
    bar('2026-06-27 09:30', 885, 886, 884.5, 885.5, 15), // 日盘
    bar('2026-06-27 10:00', 885.5, 887, 885, 887, 25),
  ];
  const r = computeIntraday(bars, 883.7);
  // 会话切片应从 2026-06-26 20:00 起(6 根)
  assert.equal(r.barsCount, 6);
  assert.equal(r.sessionHigh, 887);
  assert.equal(r.sessionLow, 883);
  // current = 末根 10:00 收盘 887
  assert.equal(r.current, 887);
  // 末根 hour=10 → 日盘
  assert.equal(r.sessionPhase, '日盘');
  // 夜盘:从 20:00 到 01:00(4 根),close=885
  assert.equal(r.night.hasData, true);
  assert.equal(r.night.open, 883.7);
  assert.equal(r.night.close, 885);
  // 夜盘收盘 885 vs 前收 883.7 → +0.147%
  assert.equal(Math.round(r.night.chgPct * 10000) / 10000, 0.1471);
  // 日盘有数据
  assert.equal(r.day.hasData, true);
  assert.equal(r.day.high, 887);
});

test('computeIntraday: VWAP = Σ(close*vol)/Σ(vol)', () => {
  // 只构造一个会话(20:00 起 3 根),手算 VWAP
  const bars = [
    bar('2026-06-26 20:00', 100, 102, 100, 101, 10), // 101*10=1010
    bar('2026-06-26 20:01', 101, 103, 101, 102, 20), // 102*20=2040
    bar('2026-06-26 20:02', 102, 104, 102, 103, 30), // 103*30=3090
  ];
  // ΣPV=6140, ΣV=60 → VWAP=102.333
  const r = computeIntraday(bars, 100);
  assert.equal(Math.round(r.vwap * 1000) / 1000, 102.333);
  assert.equal(r.sessionPhase, '夜盘');
  // 距 VWAP = 103 - 102.333 = 0.667
  assert.equal(Math.round(r.distVwap * 1000) / 1000, 0.667);
});

test('computeIntraday: 全零成交量时 VWAP 回退为最新收盘(不除零)', () => {
  const bars = [
    bar('2026-06-26 20:00', 100, 100, 100, 100, 0),
    bar('2026-06-26 20:01', 100, 100, 100, 105, 0),
  ];
  const r = computeIntraday(bars, 100);
  assert.equal(r.vwap, 105);
  assert.equal(r.distVwap, 0);
});

test('computeIntraday: 空数组返回休市占位,不抛错', () => {
  const r = computeIntraday([], 880);
  assert.equal(r.sessionPhase, '休市');
  assert.equal(r.barsCount, 0);
  assert.equal(r.night.hasData, false);
  assert.equal(r.day.hasData, false);
  assert.equal(r.preClose, 880);
});

test('computeIntraday: 纯函数确定性(同输入恒等输出)', () => {
  const bars = [
    bar('2026-06-26 20:00', 883, 885, 883, 884, 20),
    bar('2026-06-26 20:01', 884, 886, 884, 886, 30),
  ];
  const a = computeIntraday(bars, 883.7);
  const b = computeIntraday(bars, 883.7);
  assert.deepEqual(a, b);
});

test('parseIntradayKlines: 解析东方财富 1 分线 JSON', () => {
  const json = {
    data: {
      preKPrice: 883.7,
      klines: [
        '2026-06-26 20:00,883.70,884.00,885.00,883.00,20,177000.00,0.00',
        '2026-06-26 20:01,884.00,886.00,886.00,884.00,30,265800.00,0.00',
      ],
    },
  };
  const { bars, preClose } = parseIntradayKlines(json);
  assert.equal(preClose, 883.7);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].hour, 20);
  assert.equal(bars[0].minute, 0);
  assert.equal(bars[0].open, 883.7);
  assert.equal(bars[0].close, 884);
  assert.equal(bars[0].vol, 20);
  assert.equal(bars[1].high, 886);
});

test('parseIntradayKlines: 无 klines 时抛错', () => {
  assert.throws(() => parseIntradayKlines({ data: { klines: [] } }), /无分时数据/);
  assert.throws(() => parseIntradayKlines({ data: null }), /无分时数据/);
});
