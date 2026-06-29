import type { Asset, Signal, StrategyId, StrategyMeta } from '../types.js';

export interface Strategy {
  meta: StrategyMeta;
  evaluate(asset: Asset): Signal;
}

// 综合分数 -> 动作映射
export function scoreToAction(score: number): Signal['action'] {
  if (score >= 30) return 'buy';
  if (score <= -30) return 'sell';
  return 'hold';
}

// 分数绝对值 -> 置信度(0~1)
export function toConfidence(score: number): number {
  return Math.min(1, Math.abs(score) / 100);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 自适应精度:小数值(如 MACD 的 DIF/DEA 常在 0.0x)保留更多小数位,
// 大数值(价格)保留较少位,避免指标显示成 0。
export function roundAdaptive(n: number): number {
  if (Number.isNaN(n)) return n;
  const abs = Math.abs(n);
  if (abs === 0) return 0;
  if (abs < 1) return Math.round(n * 10000) / 10000;
  if (abs < 10) return Math.round(n * 1000) / 1000;
  return Math.round(n * 100) / 100;
}

export const STRATEGIES: Record<StrategyId, Strategy> = {
  classic: null as unknown as Strategy,
  trend: null as unknown as Strategy,
  grid: null as unknown as Strategy,
};

import { classicStrategy } from './classic.js';
import { trendStrategy } from './trend.js';
import { gridStrategy } from './grid.js';

STRATEGIES.classic = classicStrategy;
STRATEGIES.trend = trendStrategy;
STRATEGIES.grid = gridStrategy;

export function getStrategy(id: string): Strategy | undefined {
  return STRATEGIES[id as StrategyId];
}

export function listStrategies(): StrategyMeta[] {
  return Object.values(STRATEGIES).map((s) => s.meta);
}
