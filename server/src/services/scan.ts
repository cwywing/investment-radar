import type { Asset, AssetRadarItem, BacktestResult } from '../types.js';
import { getAllAssets, getAsset, getAssetSlice, getAssetSource, onAssetRefresh } from '../data/dataProvider.js';
import { getStrategy, listStrategies } from '../strategies/types.js';
import { backtestSignal } from './backtest.js';

// 回测结果缓存:键 = "assetId:strategyId"。回测遍历整段历史较重,缓存避免重复。
// 失效规则:数据刷新后必须清除 —— 否则新 K 线配旧胜率(Phase1 隐患)。
// 通过订阅 dataProvider 的刷新事件自动清除该资产所有策略的回测缓存。
const backtestCache = new Map<string, ReturnType<typeof backtestSignal>>();

export function clearBacktestCache(assetId?: string): void {
  if (!assetId) { backtestCache.clear(); return; }
  for (const k of backtestCache.keys()) {
    if (k.startsWith(`${assetId}:`)) backtestCache.delete(k);
  }
}

// 订阅数据刷新:任一资产真实数据更新后,清掉它的回测缓存,下次 scanOne 重算。
onAssetRefresh((id) => clearBacktestCache(id));

// C3 低置信判定(纯函数,便于离线测试):
// 仅对真实数据生效(模拟数据回测无意义,几何布朗运动必趋势向上,胜率虚高);
// 样本>=10 避免小样本噪声被误判为"不可靠";胜率<50% 即历史十次错超五次。
export function isLowConfidence(bt: BacktestResult, loaded: string): boolean {
  if (loaded === 'simulated') return false;
  if (bt.sampleInsufficient) return false;
  return bt.matched >= 10 && Number.isFinite(bt.winRate) && bt.winRate < 0.5;
}

// 取回测(带缓存),scanAll 与 scanOne 共用同一缓存,避免列表/详情重复算。
function getBacktest(
  assetId: string,
  strategyId: string,
  full: Asset,
  strategy: NonNullable<ReturnType<typeof getStrategy>>,
): BacktestResult {
  const key = `${assetId}:${strategyId}`;
  let bt = backtestCache.get(key);
  if (!bt) {
    bt = backtestSignal(full, strategy);
    backtestCache.set(key, bt);
  }
  return bt;
}

// 扫描服务:遍历全部资产,用指定策略计算信号,产出雷达主页所需精简项。
export function scanAll(strategyId: string): AssetRadarItem[] {
  const strategy = getStrategy(strategyId);
  if (!strategy) return [];
  return getAllAssets().map((asset) => {
    const signal = strategy.evaluate(asset);
    const last = asset.candles[asset.candles.length - 1];
    const prev = asset.candles[asset.candles.length - 2];
    const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
    const src = getAssetSource(asset.id);
    const loaded = src?.loaded ?? 'simulated';
    // C3:列表也带历史胜率警示 —— 回测走共享缓存,首算后即缓存,净成本几乎为零
    const bt = getBacktest(asset.id, strategyId, asset, strategy);
    return {
      id: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      price: last.close,
      changePct: Math.round(changePct * 100) / 100,
      signal,
      loaded,
      stale: src?.stale ?? false,
      intraday: src?.intraday,
      lowConfidence: isLowConfidence(bt, loaded),
    };
  });
}

// 单资产详情(含历史回测证据)
export function scanOne(id: string, strategyId: string, days: number) {
  const strategy = getStrategy(strategyId);
  if (!strategy) return undefined;
  const asset = getAssetSlice(id, days);
  if (!asset) return undefined;
  const signal = strategy.evaluate(asset);

  // 回测需要完整历史,用未截断的资产算
  const full = getAsset(id)!;
  const bt = getBacktest(id, strategyId, full, strategy);
  return { ...asset, signal, backtest: bt };
}

// 资产是否存在
export function assetExists(id: string): boolean {
  return !!getAsset(id);
}

// 全策略概览:对单个资产,并排给出每个策略的信号 + 回测胜率 + 低置信标记。
// 供前端"策略对比"弹窗一键看 5 个策略谁说买谁说卖、历史胜率如何。
export interface StrategyOverviewRow {
  id: string;
  name: string;
  desc: string;
  suitable: string;
  action: 'buy' | 'sell' | 'hold';
  score: number;
  confidence: number;
  topReason: string;
  matched: number;
  winRate: number;       // 0~1,NaN 视为无样本
  avgReturn: number;
  lowConfidence: boolean;
}

export function scanOverview(id: string): { asset: { id: string; name: string; symbol: string }; rows: StrategyOverviewRow[] } | undefined {
  const full = getAsset(id);
  if (!full) return undefined;
  const src = getAssetSource(id);
  const loaded = src?.loaded ?? 'simulated';
  const rows: StrategyOverviewRow[] = [];
  for (const meta of listStrategies()) {
    const strat = getStrategy(meta.id);
    if (!strat) continue;
    const signal = strat.evaluate(full);
    const bt = getBacktest(id, meta.id, full, strat);
    rows.push({
      id: meta.id, name: meta.name, desc: meta.desc, suitable: meta.suitable,
      action: signal.action,
      score: signal.score,
      confidence: signal.confidence,
      topReason: signal.reasons[0] ?? '',
      matched: bt.matched,
      winRate: bt.winRate,
      avgReturn: bt.avgReturn,
      lowConfidence: isLowConfidence(bt, loaded),
    });
  }
  return { asset: { id: full.id, name: full.name, symbol: full.symbol }, rows };
}
