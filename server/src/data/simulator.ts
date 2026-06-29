import type { AssetConfig, Candle } from '../types.js';

// 模拟数据生成器(几何布朗运动)。仅作为离线/无网络/拉取失败时的兜底,
// 以及 source='simulated' 标的的来源。真实标的的信号最终来自真实数据。
// 用可复现伪随机保证同一 seed 生成同样序列,信号稳定。

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TRADING_DAYS = 250;

export function generateSimulated(cfg: AssetConfig): Candle[] {
  const rand = mulberry32(cfg.seed);
  const dt = 1 / 252;
  const candles: Candle[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - TRADING_DAYS);

  let price = cfg.basePrice * 0.85;
  for (let i = 0; i < TRADING_DAYS; i++) {
    const z = gaussian(rand);
    const ret = (cfg.drift - 0.5 * cfg.volatility ** 2) * dt
      + cfg.volatility * Math.sqrt(dt) * z;
    const open = price;
    const close = open * Math.exp(ret);
    const intraday = Math.abs(z) * cfg.volatility * Math.sqrt(dt) * open * 0.8;
    const high = Math.max(open, close) + intraday * rand() * 0.6;
    const low = Math.min(open, close) - intraday * rand() * 0.6;
    const volume = Math.round(
      (cfg.assetClass === 'metal' ? 50000 : 120000)
      * (0.6 + rand() * 0.9)
      * (1 + Math.abs(ret) * 20),
    );

    const d = new Date(start);
    d.setDate(start.getDate() + i);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);

    candles.push({
      date: d.toISOString().slice(0, 10),
      open: round(open),
      high: round(high),
      low: round(Math.max(low, Math.min(open, close) * 0.98)),
      close: round(close),
      volume,
    });
    price = close;
  }
  return candles;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
