import { ASSET_CONFIGS } from '../data/assets.js';
import { getAsset, getAssetSource } from '../data/dataProvider.js';
import { listHoldings } from '../db/holdings.js';
import { holdingKey } from '../db/database.js';
import { getStrategy } from '../strategies/types.js';
import { scanAll } from './scan.js';
import type { AssetClass, Signal } from '../types.js';

export interface PortfolioItem {
  holdingKey: string;
  assetId: string;
  accountKey: string;
  accountLabel: string | null;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  shares: number;
  costPrice: number | null;
  note: string | null;
  updatedAt: string;
  price: number;
  changePct: number;
  marketValue: number;
  weight: number;
  pnlPct: number | null;
  signal: Signal;
  strategyUsed: string;
  loaded: 'csv' | 'real' | 'simulated';
  stale: boolean;
  lowConfidence: boolean;
  proxyNote?: string;
}

export interface PortfolioSummary {
  totalValue: number;
  holdingsCount: number;
  allocation: { fundPct: number; metalPct: number };
  actionCounts: { buy: number; sell: number; hold: number };
  weightedScore: number;
  overallTone: '偏多' | '偏空' | '观望';
  advisories: string[];
  fundStrategy: string;
  goldStrategy: string;
  items: PortfolioItem[];
}

export interface PortfolioOptions {
  fundStrategy?: string;
  goldStrategy?: string;
}

const DEFAULT_FUND_STRATEGY = 'trend';
const DEFAULT_GOLD_STRATEGY = 'goldFactor';

function resolveStrategies(opts: PortfolioOptions): { fundStrategy: string; goldStrategy: string } {
  const fundStrategy = getStrategy(opts.fundStrategy ?? DEFAULT_FUND_STRATEGY)
    ? (opts.fundStrategy ?? DEFAULT_FUND_STRATEGY)
    : DEFAULT_FUND_STRATEGY;
  const goldStrategy = getStrategy(opts.goldStrategy ?? DEFAULT_GOLD_STRATEGY)
    ? (opts.goldStrategy ?? DEFAULT_GOLD_STRATEGY)
    : DEFAULT_GOLD_STRATEGY;
  return { fundStrategy, goldStrategy };
}

function strategyForClass(assetClass: AssetClass, s: { fundStrategy: string; goldStrategy: string }): string {
  return assetClass === 'metal' ? s.goldStrategy : s.fundStrategy;
}

function buildAdvisories(items: PortfolioItem[], weightedScore: number): string[] {
  const lines: string[] = [];
  if (items.length === 0) return lines;

  if (weightedScore >= 30) {
    lines.push('组合加权信号偏多,可优先关注持仓中的买入信号标的。');
  } else if (weightedScore <= -30) {
    lines.push('组合加权信号偏空,建议优先审视卖出信号标的,尤其重仓项。');
  } else {
    lines.push('组合加权信号中性,整体以观望为主,按单标的信号逐一评估。');
  }

  for (const item of items) {
    if (item.loaded === 'simulated') {
      lines.push(`⚠ ${item.name} 当前为模拟行情,信号不可作为真实依据。`);
    }
  }

  for (const item of [...items].filter((i) => i.signal.action === 'sell').sort((a, b) => b.weight - a.weight)) {
    if (item.weight >= 0.2) {
      lines.push(`【优先】${item.name} 占 ${(item.weight * 100).toFixed(1)}% 且为卖出信号,建议评估减仓。`);
    }
  }

  const top = [...items].sort((a, b) => b.weight - a.weight)[0];
  if (top && top.weight >= 0.5) {
    lines.push(`集中度提示:${top.name} 占 ${(top.weight * 100).toFixed(1)}%,分散风险需留意。`);
  }

  const buyHeld = items.filter((i) => i.signal.action === 'buy' && i.weight < 0.15);
  if (buyHeld.length > 0 && weightedScore >= 15) {
    lines.push(`轻仓买入信号:${buyHeld.map((i) => i.name).join('、')} 可考虑适度加仓。`);
  }

  return lines;
}

export function buildPortfolioSummary(opts: PortfolioOptions = {}): PortfolioSummary {
  const strategies = resolveStrategies(opts);
  const holdings = listHoldings();
  const radarByStrategy = new Map<string, ReturnType<typeof scanAll>>();

  function radarFor(strategyId: string) {
    let cached = radarByStrategy.get(strategyId);
    if (!cached) {
      cached = scanAll(strategyId);
      radarByStrategy.set(strategyId, cached);
    }
    return cached;
  }

  const rawItems: Omit<PortfolioItem, 'weight'>[] = [];

  for (const h of holdings) {
    const cfg = ASSET_CONFIGS.find((a) => a.id === h.assetId);
    if (!cfg) continue;

    const strategyId = strategyForClass(cfg.assetClass, strategies);
    const strategy = getStrategy(strategyId);
    const asset = getAsset(h.assetId);
    if (!strategy || !asset || asset.candles.length === 0) continue;

    const radarItem = radarFor(strategyId).find((r) => r.id === h.assetId);
    const last = asset.candles[asset.candles.length - 1];
    const price = radarItem?.intraday?.price ?? last.close;
    const changePct = radarItem?.intraday?.changePct ?? radarItem?.changePct ?? 0;
    const marketValue = h.shares * price;
    const src = getAssetSource(h.assetId);
    const loaded = src?.loaded ?? 'simulated';

    rawItems.push({
      holdingKey: holdingKey(h.assetId, h.accountKey),
      assetId: h.assetId,
      accountKey: h.accountKey,
      accountLabel: h.accountLabel,
      name: cfg.name,
      symbol: cfg.symbol,
      assetClass: cfg.assetClass,
      shares: h.shares,
      costPrice: h.costPrice,
      note: h.note,
      updatedAt: h.updatedAt,
      price,
      changePct: Math.round(changePct * 100) / 100,
      marketValue,
      pnlPct: h.costPrice && h.costPrice > 0
        ? Math.round(((price - h.costPrice) / h.costPrice) * 10000) / 100
        : null,
      signal: radarItem?.signal ?? strategy.evaluate(asset),
      strategyUsed: strategyId,
      loaded,
      stale: src?.stale ?? false,
      lowConfidence: radarItem?.lowConfidence ?? false,
      proxyNote: src?.proxyNote,
    });
  }

  const totalValue = rawItems.reduce((s, i) => s + i.marketValue, 0);
  const fundValue = rawItems.filter((i) => i.assetClass === 'fund').reduce((s, i) => s + i.marketValue, 0);
  const metalValue = rawItems.filter((i) => i.assetClass === 'metal').reduce((s, i) => s + i.marketValue, 0);

  const items: PortfolioItem[] = rawItems.map((item) => ({
    ...item,
    weight: totalValue > 0 ? item.marketValue / totalValue : 0,
  })).sort((a, b) => b.weight - a.weight);

  const actionCounts = { buy: 0, sell: 0, hold: 0 };
  let weightedScore = 0;
  for (const item of items) {
    actionCounts[item.signal.action]++;
    weightedScore += item.weight * item.signal.score;
  }
  weightedScore = Math.round(weightedScore * 10) / 10;

  const overallTone: PortfolioSummary['overallTone'] =
    weightedScore >= 30 ? '偏多' : weightedScore <= -30 ? '偏空' : '观望';

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    holdingsCount: items.length,
    allocation: {
      fundPct: totalValue > 0 ? Math.round((fundValue / totalValue) * 1000) / 10 : 0,
      metalPct: totalValue > 0 ? Math.round((metalValue / totalValue) * 1000) / 10 : 0,
    },
    actionCounts,
    weightedScore,
    overallTone,
    advisories: buildAdvisories(items, weightedScore),
    fundStrategy: strategies.fundStrategy,
    goldStrategy: strategies.goldStrategy,
    items,
  };
}

export function listAssetOptions() {
  return ASSET_CONFIGS.map((a) => ({
    id: a.id,
    name: a.name,
    symbol: a.symbol,
    assetClass: a.assetClass,
  }));
}
