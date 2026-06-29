import type { AssetRadarItem } from '../types.js';
import { getAllAssets, getAsset, getAssetSlice } from '../data/dataProvider.js';
import { getStrategy } from '../strategies/types.js';
import { backtestSignal } from './backtest.js';

// 回测结果缓存:键 = "assetId:strategyId"。回测遍历整段历史较重,缓存避免重复。
const backtestCache = new Map<string, ReturnType<typeof backtestSignal>>();

// 扫描服务:遍历全部资产,用指定策略计算信号,产出雷达主页所需精简项。
export function scanAll(strategyId: string): AssetRadarItem[] {
  const strategy = getStrategy(strategyId);
  if (!strategy) return [];
  return getAllAssets().map((asset) => {
    const signal = strategy.evaluate(asset);
    const last = asset.candles[asset.candles.length - 1];
    const prev = asset.candles[asset.candles.length - 2];
    const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
    return {
      id: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      price: last.close,
      changePct: Math.round(changePct * 100) / 100,
      signal,
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
  const key = `${id}:${strategyId}`;
  let bt = backtestCache.get(key);
  if (!bt) {
    bt = backtestSignal(full, strategy);
    backtestCache.set(key, bt);
  }
  return { ...asset, signal, backtest: bt };
}

// 资产是否存在
export function assetExists(id: string): boolean {
  return !!getAsset(id);
}
