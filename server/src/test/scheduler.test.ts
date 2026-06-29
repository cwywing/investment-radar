import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRefresh, isTradingDay, planNotify } from '../scheduler.js';
import { ASSET_CONFIGS } from '../data/assets.js';

const allIds = ASSET_CONFIGS.map((c) => c.id);
const metalIds = ASSET_CONFIGS.filter((c) => c.assetClass === 'metal').map((c) => c.id);
// 2026-06-29 是周一(交易日);2026-06-28 周六
const mon1530 = new Date(2026, 5, 29, 15, 30);
const mon2200 = new Date(2026, 5, 29, 22, 0);
const mon0230 = new Date(2026, 5, 30, 2, 30); // 周二凌晨 02:30(夜盘跨日)
const sat1530 = new Date(2026, 5, 27, 15, 30); // 周六
const mon1531 = new Date(2026, 5, 29, 15, 31);
const mon1200 = new Date(2026, 5, 29, 12, 0);

test('isTradingDay:工作日 true,周末 false', () => {
  assert.equal(isTradingDay(new Date(2026, 5, 29)), true); // 周一
  assert.equal(isTradingDay(new Date(2026, 5, 27)), false); // 周六
  assert.equal(isTradingDay(new Date(2026, 5, 28)), false); // 周日
});

test('planRefresh 15:30 -> 全资产', () => {
  const p = planRefresh(mon1530);
  assert.ok(p);
  assert.deepEqual(p!.ids.sort(), [...allIds].sort());
});

test('planRefresh 22:00 -> 全资产', () => {
  const p = planRefresh(mon2200);
  assert.ok(p);
  assert.deepEqual(p!.ids.sort(), [...allIds].sort());
});

test('planRefresh 02:30 -> 仅黄金(夜盘)', () => {
  const p = planRefresh(mon0230);
  assert.ok(p);
  assert.deepEqual(p!.ids.sort(), [...metalIds].sort());
});

test('planRefresh 周末 15:30 -> null(不空跑)', () => {
  assert.equal(planRefresh(sat1530), null);
});

test('planRefresh 非调度时点 -> null', () => {
  assert.equal(planRefresh(mon1531), null); // 15:31
  assert.equal(planRefresh(mon1200), null); // 12:00
});

test('planNotify 22:10 工作日 -> true,其他时点/周末 -> false', () => {
  assert.equal(planNotify(new Date(2026, 5, 29, 22, 10)), true); // 周一 22:10
  assert.equal(planNotify(new Date(2026, 5, 29, 22, 0)), false); // 22:00 非通知点
  assert.equal(planNotify(new Date(2026, 5, 27, 22, 10)), false); // 周六
});
