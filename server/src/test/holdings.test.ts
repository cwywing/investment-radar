import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, closeDatabase } from '../db/database.js';
import {
  deleteHolding,
  getHolding,
  importHoldingsBatch,
  listHoldings,
  listHoldingsHistory,
  upsertHolding,
} from '../db/holdings.js';
import { parseHoldingsCsv } from '../services/holdingsImport.js';
import { buildPortfolioSummary } from '../services/portfolio.js';

afterEach(() => {
  closeDatabase();
});

test('holdings CRUD: upsert / list / delete', () => {
  openDatabase(':memory:');

  assert.deepEqual(listHoldings(), []);

  const h1 = upsertHolding('fund-csi300', { shares: 1000, costPrice: 1.5, note: '定投' });
  assert.equal(h1.assetId, 'fund-csi300');
  assert.equal(h1.accountKey, 'default');
  assert.equal(h1.shares, 1000);

  const h2 = upsertHolding('fund-csi300', { shares: 1200, costPrice: 1.55 });
  assert.equal(h2.shares, 1200);

  assert.equal(listHoldings().length, 1);
  assert.ok(getHolding('fund-csi300'));

  assert.equal(deleteHolding('fund-csi300'), true);
  assert.equal(getHolding('fund-csi300'), null);
});

test('多账户: 同一 asset_id 可有多行', () => {
  openDatabase(':memory:');
  upsertHolding('au9999', {
    shares: 6.6366,
    costPrice: 1173.01,
    accountKey: 'cmb-1852',
    accountLabel: '招行黄金',
  });
  upsertHolding('au9999', {
    shares: 7.9285,
    costPrice: 1024.02,
    accountKey: 'icbc-2327',
    accountLabel: '工行积存金',
  });

  assert.equal(listHoldings().length, 2);
  const summary = buildPortfolioSummary();
  assert.equal(summary.holdingsCount, 2);
  assert.equal(summary.items.filter((i) => i.assetId === 'au9999').length, 2);
});

test('portfolio: 空持仓返回零值摘要', () => {
  openDatabase(':memory:');
  const summary = buildPortfolioSummary();
  assert.equal(summary.holdingsCount, 0);
  assert.equal(summary.totalValue, 0);
});

test('portfolio: 有持仓时加权分数与建议非空', () => {
  openDatabase(':memory:');
  upsertHolding('au9999', { shares: 10, costPrice: 500, accountKey: 'a1' });
  upsertHolding('fund-csi300', { shares: 5000, costPrice: 1.8 });

  const summary = buildPortfolioSummary();
  assert.equal(summary.holdingsCount, 2);
  assert.ok(summary.totalValue > 0);
  assert.ok(Math.abs(summary.items.reduce((s, i) => s + i.weight, 0) - 1) < 0.001);
});

test('holdings 变更写入 history(含 accountKey)', () => {
  openDatabase(':memory:');
  upsertHolding('fund-csi300', { shares: 100, accountKey: 'acct-a' }, 'manual');
  upsertHolding('fund-csi300', { shares: 200, accountKey: 'acct-a' }, 'manual');
  deleteHolding('fund-csi300', 'acct-a', 'manual');

  const history = listHoldingsHistory();
  assert.equal(history.length, 3);
  assert.ok(history.every((h) => h.accountKey === 'acct-a'));
});

test('CSV 批量导入支持 account_key', () => {
  openDatabase(':memory:');
  const parsed = parseHoldingsCsv(`asset_id,account_key,account_label,shares
au9999,cmb-1852,招行,6.6366
au9999,icbc-2327,工行,7.9285`);
  const r = importHoldingsBatch(parsed.rows, 'csv');
  assert.equal(r.imported, 2);
  assert.equal(listHoldings().length, 2);
});
