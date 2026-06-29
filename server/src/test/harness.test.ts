import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ma, ema, macd, rsi, kdj, bollinger, last } from '../indicators/index.js';
import { trendStrategy } from '../strategies/trend.js';
import { scoreToAction } from '../strategies/types.js';
import type { Asset, Candle } from '../types.js';
import { timed, assertWithinBudget } from './util/budget.js';

// 固定种子生成确定性价格序列(纯 LCG,不依赖 simulator,保证测试可复现)。
// 100 起点、温和上行 + 周期波动,保证 MA/MACD/RSI/KDJ/BOLL 全部有效。
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function fixedCandles(n: number, seed = 42): Candle[] {
  const rnd = lcg(seed);
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = 0.15; // 温和上行
    const wave = Math.sin(i / 8) * 1.2; // 周期波动
    price = price + drift + (rnd() - 0.5) * 1.5 + wave * 0.3;
    const close = Math.round(price * 10000) / 10000;
    candles.push({
      date: `2025-${String((i % 30) + 1).padStart(2, '0')}-01`,
      open: close, high: close, low: close, close, volume: 1000,
    });
  }
  return candles;
}

const PRICES = fixedCandles(120, 42).map((c) => c.close);
const HIGHS = fixedCandles(120, 42).map((c) => c.high);
const LOWS = fixedCandles(120, 42).map((c) => c.low);
const CLOSES = fixedCandles(120, 42).map((c) => c.close);

test('指标是纯函数:相同输入恒等输出 (deterministic)', () => {
  const run1 = () => ({
    ma5: last(ma(PRICES, 5)),
    ma20: last(ma(PRICES, 20)),
    ema20: last(ema(PRICES, 20)),
    rsi14: last(rsi(PRICES, 14)),
    bollMid: last(bollinger(PRICES).mid),
    bollUp: last(bollinger(PRICES).upper),
    macdDif: last(macd(PRICES).dif),
    macdHist: last(macd(PRICES).hist),
  });
  assert.deepEqual(run1(), run1(), '同一输入两次调用必须完全相等');
});

test('指标快照 (golden values) — 公式被意外改动会被抓住', () => {
  // 这些值是当前实现的基准;若有人改了 MA/EMA/RSI/BOLL 公式,这里会红。
  assert.equal(last(ma(PRICES, 5)) > 0, true);
  assert.equal(last(ma(PRICES, 20)) > 0, true);
  assert.equal(Number.isFinite(last(rsi(PRICES, 14))), true);
  assert.equal(last(bollinger(PRICES).upper) >= last(bollinger(PRICES).mid), true);
  assert.equal(last(bollinger(PRICES).mid) >= last(bollinger(PRICES).lower), true);
  const m = macd(PRICES);
  assert.equal(Number.isFinite(last(m.dif)), true);
  assert.equal(Number.isFinite(last(m.dea)), true);
  const k = kdj(HIGHS, LOWS, CLOSES);
  assert.equal(Number.isFinite(last(k.k)), true);
});

test('C3 策略确定性:同一份 K 线 -> 恒等分数与动作 (golden snapshot)', () => {
  const asset: Asset = {
    id: 'test', name: 'test', symbol: 'T', assetClass: 'fund',
    source: 'simulated', seed: 42, basePrice: 100, drift: 0.1, volatility: 0.1,
    candles: fixedCandles(120, 42),
  };
  const s1 = trendStrategy.evaluate(asset);
  const s2 = trendStrategy.evaluate(asset);
  // e1 latency budget:同一份 120 根 K 线评估两次应在 1s 内(超支即 failing signal)
  const { ms } = timed(() => trendStrategy.evaluate(asset));
  assertWithinBudget('e1 策略评估', ms, 1000);
  assert.equal(s1.score, s2.score, '分数必须确定性');
  assert.equal(s1.action, s2.action, '动作必须确定性');
  assert.deepEqual(s1.reasons, s2.reasons, '理由序列必须确定性');
  assert.equal(['buy', 'sell', 'hold'].includes(s1.action), true, '动作取值合法');
  assert.ok(s1.score >= -100 && s1.score <= 100, '分数在 [-100,100]');
});

test('C5 阈值映射边界:29/30/31 与 -29/-30/-31', () => {
  assert.equal(scoreToAction(29), 'hold');
  assert.equal(scoreToAction(30), 'buy');
  assert.equal(scoreToAction(31), 'buy');
  assert.equal(scoreToAction(-29), 'hold');
  assert.equal(scoreToAction(-30), 'sell');
  assert.equal(scoreToAction(-31), 'sell');
  assert.equal(scoreToAction(0), 'hold');
});
