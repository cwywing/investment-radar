import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale } from '../data/dataProvider.js';

// e3 —— C2 数据新鲜度校验:过期数据必须被识别(前端据此警告)。
// 阈值:基金 8 天、黄金 6 天(保守,避长假误报)。
const NOW = new Date('2026-06-29T03:00:00Z'); // 周一

function daysAgo(n: number): string {
  const d = new Date(NOW.getTime() - n * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

test('基金:最新K线 3 天前(周五) -> 新鲜', () => {
  assert.equal(isStale(daysAgo(3), 'fund', NOW), false);
});

test('基金:最新K线 9 天前 -> 过期', () => {
  assert.equal(isStale(daysAgo(9), 'fund', NOW), true);
});

test('黄金:最新K线 7 天前(国庆级) -> 新鲜,10 天前 -> 过期', () => {
  assert.equal(isStale(daysAgo(7), 'metal', NOW), false);
  assert.equal(isStale(daysAgo(10), 'metal', NOW), true);
});

test('长假不误报:基金 7 天前(国庆级)仍新鲜', () => {
  assert.equal(isStale(daysAgo(7), 'fund', NOW), false);
});

test('坏日期 -> 过期', () => {
  assert.equal(isStale('not-a-date', 'fund', NOW), true);
  assert.equal(isStale('', 'metal', NOW), true);
});

test('今天 -> 新鲜', () => {
  assert.equal(isStale('2026-06-29', 'fund', NOW), false);
});
