import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoldingsCsv } from '../services/holdingsImport.js';

test('parseHoldingsCsv: asset_id + shares 解析', () => {
  const csv = `asset_id,shares,cost_price,note
fund-csi300,1000,1.85,定投
au9999,10,560,`;
  const r = parseHoldingsCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].assetId, 'fund-csi300');
  assert.equal(r.rows[0].shares, 1000);
  assert.equal(r.rows[1].assetId, 'au9999');
});

test('parseHoldingsCsv: symbol 列可替代 asset_id', () => {
  const csv = `symbol,shares
110020,500
AU9999,5`;
  const r = parseHoldingsCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].assetId, 'fund-csi300');
  assert.equal(r.rows[1].assetId, 'au9999');
});

test('parseHoldingsCsv: account_key 列', () => {
  const csv = `asset_id,account_key,account_label,shares
au9999,cmb-1852,招行,6.6366`;
  const r = parseHoldingsCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].accountKey, 'cmb-1852');
  assert.equal(r.rows[0].accountLabel, '招行');
});

test('parseHoldingsCsv: 未知标的记入 errors', () => {
  const csv = `asset_id,shares
unknown-fund,100`;
  const r = parseHoldingsCsv(csv);
  assert.equal(r.rows.length, 0);
  assert.ok(r.errors.some((e) => e.includes('未识别')));
});
