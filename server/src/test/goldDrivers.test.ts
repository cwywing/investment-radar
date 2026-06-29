import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeGold, parseXau, parseEmQuote } from '../data/goldDrivers.js';

test('decomposeGold: 三因子拆解数学正确(纯函数)', () => {
  // 构造:au9999=886, 前收=880 → auChg +0.6818%
  // XAU=4059, 昨结=4081 → xauChg -0.5391%
  // CNH=6.7988, 昨收=6.8045 → cnyChg -0.0838%(CNH 跌=人民币升值)
  // rmbImplied = 4059*6.7988/31.1035 = 887.24
  // premium = 886 - 887.24 = -1.24
  // premiumContrib = 0.6818 - (-0.5391) - (-0.0838) = 1.3047
  const r = decomposeGold(886, 880, 4059, 4081, 6.7988, 6.8045);
  assert.equal(Math.round(r.rmbImplied * 100) / 100, 887.24);
  assert.equal(Math.round(r.premium * 100) / 100, -1.24);
  assert.equal(r.premiumStatus, '正常');
  assert.equal(Math.round(r.auChgPct * 10000) / 10000, 0.6818);
  assert.equal(Math.round(r.xauChgPct * 10000) / 10000, -0.5391);
  assert.equal(Math.round(r.cnyChgPct * 10000) / 10000, -0.0838);
  assert.equal(r.intlContrib, r.xauChgPct);
  assert.equal(r.fxContrib, r.cnyChgPct);
  // 溢价贡献 = au - xau - cny
  assert.equal(Math.round(r.premiumContrib * 10000) / 10000, 1.3047);
});

test('decomposeGold: 溢价状态分级(异常偏高/贴水/正常)', () => {
  // premium = au - rmbImplied; rmbImplied = 4059*6.8/31.1035 ≈ 887.5
  // au=895 → premium≈7.5 → 异常偏高
  const high = decomposeGold(895, 890, 4059, 4059, 6.8, 6.8);
  assert.equal(high.premiumStatus, '异常偏高');
  // au=880 → premium≈-7.5 → 贴水倒挂
  const low = decomposeGold(880, 885, 4059, 4059, 6.8, 6.8);
  assert.equal(low.premiumStatus, '贴水倒挂');
  // au=887 → premium≈-0.5 → 正常
  const normal = decomposeGold(887, 885, 4059, 4059, 6.8, 6.8);
  assert.equal(normal.premiumStatus, '正常');
});

test('decomposeGold: 昨收为 0 或非法时不抛错,贡献回退为 0', () => {
  const r = decomposeGold(886, 0, 4059, 4081, 6.7988, 6.8045);
  assert.equal(r.auChgPct, 0);
  assert.ok(Number.isFinite(r.premium));
  assert.ok(Number.isFinite(r.premiumContrib));
});

test('decomposeGold: 纯函数确定性(同输入恒等输出)', () => {
  const a = decomposeGold(886, 880, 4059, 4081, 6.7988, 6.8045);
  const b = decomposeGold(886, 880, 4059, 4081, 6.7988, 6.8045);
  assert.deepEqual(a, b);
});

test('parseXau: 解析新浪 hf_XAU 行(index0=最新,index7=昨结)', () => {
  const text = 'var hq_str_hf_XAU="4058.84,4081.020,4058.84,4059.19,4085.96,4039.36,14:16:00,4081.02,4081.81,0,0,0,2026-06-29,伦敦金现货外盘";';
  const r = parseXau(text);
  assert.equal(r.price, 4058.84);
  assert.equal(r.prevClose, 4081.02);
});

test('parseXau: 格式不符时抛错', () => {
  assert.throws(() => parseXau('garbage'), /XAU 解析失败/);
});

test('parseEmQuote: 解析东方财富外汇(缩放 1e4)', () => {
  const json = { data: { f43: 67986, f60: 68045, f170: -9 } };
  const r = parseEmQuote(json, 10000);
  assert.equal(r.price, 6.7986);
  assert.equal(r.prevClose, 6.8045);
  assert.equal(r.chgPct, -0.09);
});

test('parseEmQuote: 解析美元指数(缩放 1e2)', () => {
  const json = { data: { f43: 10129, f60: 10138, f170: -9 } };
  const r = parseEmQuote(json, 100);
  assert.equal(r.price, 101.29);
  assert.equal(r.prevClose, 101.38);
  assert.equal(r.chgPct, -0.09);
});

test('parseEmQuote: 无 data 时抛错', () => {
  assert.throws(() => parseEmQuote({ data: null }, 100), /EM 无数据/);
  assert.throws(() => parseEmQuote({}, 100), /EM 无数据/);
});
