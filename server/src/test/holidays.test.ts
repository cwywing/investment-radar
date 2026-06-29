import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTradingDay, isOffDay, isExtraWorkday } from '../data/holidays.js';
import { planRefresh } from '../scheduler.js';

// 用 holidays.json 里的真实日期验证交易日历(含调休)。
// 2026-01-01 元旦(周四,休假日) -> 非交易日
// 2026-01-04 周日(春节调休上班) -> 交易日
// 2026-02-15 周日(春节休假日) -> 非交易日

test('节假日:2026-01-01 元旦(周四)是非交易日', () => {
  assert.equal(isOffDay('2026-01-01'), true);
  assert.equal(isTradingDay(new Date(2026, 0, 1, 15, 30)), false); // 周四但放假
});

test('调休:2026-01-04 周日是调休上班日 -> 交易日', () => {
  assert.equal(isExtraWorkday('2026-01-04'), true);
  assert.equal(isTradingDay(new Date(2026, 0, 4, 15, 30)), true); // 周日但调休上班
});

test('春节假期:2026-02-15 周日是休假日 -> 非交易日', () => {
  assert.equal(isOffDay('2026-02-15'), true);
  assert.equal(isTradingDay(new Date(2026, 1, 15, 15, 30)), false);
});

test('普通工作日:2026-06-29 周一 -> 交易日', () => {
  assert.equal(isTradingDay(new Date(2026, 5, 29, 15, 30)), true);
});

test('普通周末:2026-06-27 周六(非调休) -> 非交易日', () => {
  assert.equal(isExtraWorkday('2026-06-27'), false);
  assert.equal(isTradingDay(new Date(2026, 5, 27, 15, 30)), false);
});

test('planRefresh 节假日(周四元旦)15:30 -> null(不空跑)', () => {
  assert.equal(planRefresh(new Date(2026, 0, 1, 15, 30)), null);
});

test('planRefresh 调休周日 15:30 -> 全资产(调休算交易日)', () => {
  const p = planRefresh(new Date(2026, 0, 4, 15, 30));
  assert.ok(p, '调休日应触发刷新');
  assert.ok(p!.ids.length >= 7, '应刷新全部资产');
});
