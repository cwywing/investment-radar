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
  trend: null as unknown as Strategy,
  regime: null as unknown as Strategy,
  goldFactor: null as unknown as Strategy,
};

import { trendStrategy } from './trend.js';
import { regimeStrategy } from './regime.js';
import { goldFactorStrategy } from './goldFactor.js';

// 注意:strategy 模块会反向 import 本模块的 scoreToAction 等工具函数,
// 形成 types <-> trend/regime/goldFactor 的循环依赖。若在顶层立即赋值
// STRATEGIES.trend = trendStrategy,当本模块不是循环的"入口"时
// (即别的模块先 import trend.ts),trendStrategy 尚在 TDZ 会被访问,
// 抛 ReferenceError。因此把解析推迟到首次调用时——此时所有模块已完成初始化。
function ensureLoaded(): void {
  if (STRATEGIES.trend) return;
  STRATEGIES.trend = trendStrategy;
  STRATEGIES.regime = regimeStrategy;
  STRATEGIES.goldFactor = goldFactorStrategy;
}

export function getStrategy(id: string): Strategy | undefined {
  ensureLoaded();
  return STRATEGIES[id as StrategyId];
}

export function listStrategies(): StrategyMeta[] {
  ensureLoaded();
  return Object.values(STRATEGIES).map((s) => s.meta);
}
