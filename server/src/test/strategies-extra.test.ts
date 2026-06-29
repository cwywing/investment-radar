import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atr, adx, supertrend, last } from '../indicators/index.js';
import { regimeStrategy } from '../strategies/regime.js';
import { volatilityFilter } from '../strategies/volFilter.js';
import type { Asset, Candle } from '../types.js';
import { timed, assertWithinBudget } from './util/budget.js';

// 带上下影线的确定性 K 线(纯 LCG),保证 ATR/ADX/Supertrend 有真实波幅。
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function wickCandles(n: number, seed = 7): Candle[] {
  const rnd = lcg(seed);
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = 0.12;
    const wave = Math.sin(i / 9) * 1.5;
    price = price + drift + (rnd() - 0.5) * 2 + wave * 0.4;
    const close = Math.round(price * 10000) / 10000;
    const wickUp = Math.round((rnd() * 1.5) * 10000) / 10000;
    const wickDn = Math.round((rnd() * 1.5) * 10000) / 10000;
    candles.push({
      date: `2025-${String((i % 30) + 1).padStart(2, '0')}-01`,
      open: close, close,
      high: close + wickUp,
      low: close - wickDn,
      volume: 1000,
    });
  }
  return candles;
}

const C = wickCandles(160, 7);
const HIGHS = C.map((c) => c.high);
const LOWS = C.map((c) => c.low);
const CLOSES = C.map((c) => c.close);

function makeAsset(seed = 7): Asset {
  return {
    id: 'test', name: 'test', symbol: 'T', assetClass: 'fund',
    source: 'simulated', seed, basePrice: 100, drift: 0.1, volatility: 0.1,
    candles: wickCandles(160, seed),
  };
}

test('ATR: 纯函数确定性 + 取值合理(>0,日线波幅通常<价格的 10%)', () => {
  const a1 = atr(HIGHS, LOWS, CLOSES, 14);
  const a2 = atr(HIGHS, LOWS, CLOSES, 14);
  assert.deepEqual(a1, a2, '相同输入两次调用必须完全相等');
  const v = last(a1);
  assert.ok(Number.isFinite(v), 'ATR 末值有限');
  assert.ok(v > 0, 'ATR 必须为正(有波幅)');
  assert.ok(v < CLOSES[CLOSES.length - 1] * 0.1, 'ATR 应小于价格的 10%');
});

test('ADX: 纯函数确定性 + 取值在 [0,100]', () => {
  const x1 = adx(HIGHS, LOWS, CLOSES, 14);
  const x2 = adx(HIGHS, LOWS, CLOSES, 14);
  assert.deepEqual(x1, x2);
  const v = last(x1);
  assert.ok(Number.isFinite(v), 'ADX 末值有限');
  assert.ok(v >= 0 && v <= 100, 'ADX 必须在 [0,100]');
});

test('ADX: 单边上涨应判为趋势市(ADX 偏高)', () => {
  // 构造强趋势序列:每日稳定上涨
  const up: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 80; i++) {
    p = p * 1.006;
    const c = Math.round(p * 100) / 100;
    up.push({ date: `2025-01-${String(i + 1).padStart(2, '0')}`, open: c, close: c, high: c + 0.5, low: c - 0.3, volume: 1000 });
  }
  const v = last(adx(up.map((x) => x.high), up.map((x) => x.low), up.map((x) => x.close), 14));
  assert.ok(v > 25, `强趋势 ADX 应 >25,实际 ${v}`);
});

test('Supertrend: 纯函数确定性 + dir 取值 {-1,1}', () => {
  const s1 = supertrend(HIGHS, LOWS, CLOSES, 10, 3);
  const s2 = supertrend(HIGHS, LOWS, CLOSES, 10, 3);
  assert.deepEqual(s1.value, s2.value);
  assert.deepEqual(s1.dir, s2.dir);
  const d = last(s1.dir);
  assert.ok(d === 1 || d === -1, 'dir 末值必须是 1 或 -1');
  assert.ok(Number.isFinite(last(s1.value)), 'value 末值有限');
});

test('volatilityFilter: 阈值分级正确(纯函数)', () => {
  // 价格 100,ATR=1 → 1% → low
  assert.equal(volatilityFilter(100, 1).level, 'low');
  assert.equal(volatilityFilter(100, 1).ok, true);
  assert.equal(volatilityFilter(100, 1).factor, 1);
  // ATR=4 → 4% → normal
  assert.equal(volatilityFilter(100, 4).level, 'normal');
  assert.equal(volatilityFilter(100, 4).factor, 1);
  // ATR=6 → 6% → high,置信 0.7 折扣
  assert.equal(volatilityFilter(100, 6).level, 'high');
  assert.equal(volatilityFilter(100, 6).ok, true);
  assert.equal(volatilityFilter(100, 6).factor, 0.7);
  // ATR=9 → 9% → extreme,禁用
  assert.equal(volatilityFilter(100, 9).level, 'extreme');
  assert.equal(volatilityFilter(100, 9).ok, false);
  assert.equal(volatilityFilter(100, 9).factor, 0);
  // 边界:5% normal,5.01% high;8% extreme
  assert.equal(volatilityFilter(100, 5).level, 'normal');
  assert.equal(volatilityFilter(100, 5.01).level, 'high');
  assert.equal(volatilityFilter(100, 8.01).level, 'extreme');
  // 非法输入兜底
  assert.equal(volatilityFilter(0, 1).ok, true);
  assert.equal(volatilityFilter(100, NaN).ok, true);
});

test('regime 策略: 纯函数确定性 + 动作合法 + latency 预算', () => {
  const asset = makeAsset(7);
  const s1 = regimeStrategy.evaluate(asset);
  const s2 = regimeStrategy.evaluate(asset);
  const { ms } = timed(() => regimeStrategy.evaluate(asset));
  assertWithinBudget('regime 评估', ms, 1000);
  assert.equal(s1.score, s2.score, '分数确定性');
  assert.equal(s1.action, s2.action, '动作确定性');
  assert.deepEqual(s1.reasons, s2.reasons, '理由序列确定性');
  assert.ok(['buy', 'sell', 'hold'].includes(s1.action), '动作合法');
  assert.ok(s1.score >= -100 && s1.score <= 100, '分数在 [-100,100]');
  // regime 必须输出 ADX 指标(核心判据)
  assert.ok('ADX' in s1.indicators, '必须暴露 ADX 指标');
});

test('regime 策略: 极端波动(ATR>8%)强制 hold', () => {
  // 构造极端波动:每根波幅 ~10%
  const wild: Candle[] = [];
  let p = 100;
  const rnd = lcg(99);
  for (let i = 0; i < 160; i++) {
    const move = (rnd() - 0.5) * 20; // 大幅波动
    p = Math.max(10, p + move);
    const c = Math.round(p * 100) / 100;
    wild.push({ date: `2025-01-${String(i + 1).padStart(2, '0')}`, open: c, close: c, high: c + 8, low: c - 8, volume: 1000 });
  }
  const asset: Asset = {
    id: 'wild', name: 'wild', symbol: 'W', assetClass: 'fund',
    source: 'simulated', seed: 99, basePrice: 100, drift: 0.1, volatility: 0.1,
    candles: wild,
  };
  const s = regimeStrategy.evaluate(asset);
  assert.equal(s.action, 'hold', '极端波动必须 hold');
  assert.equal(s.confidence, 0, '极端波动置信为 0');
  assert.ok(s.reasons.some((r) => r.includes('极端波动')), '必须有极端波动提示');
});
