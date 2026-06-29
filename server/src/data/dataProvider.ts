import type { Asset, AssetConfig, Candle } from '../types.js';
import { ASSET_CONFIGS, getAssetConfig } from './assets.js';
import { generateSimulated } from './simulator.js';
import { fetchGoldCandles } from './providers/eastmoney.js';
import { fetchFundCandles } from './providers/tiantian.js';
import { loadCsvCandles } from './providers/csv.js';

// 三级数据源架构,优先级:CSV导入 > 在线真实数据 > 模拟数据。
// 上层(getAsset / getAllAssets)接口保持不变,策略与前端零改动。

interface CacheEntry {
  asset: Asset;
  ts: number;       // 抓取时间戳
  from: 'csv' | 'real' | 'simulated';
}

const TTL = 1000 * 60 * 60; // 在线数据缓存 1 小时(实时性 vs 限流的平衡)
const cache = new Map<string, CacheEntry>();

// 同步获取(优先返回缓存)。首次访问会异步拉取,期间回退模拟数据。
export function getAsset(id: string): Asset | undefined {
  const entry = cache.get(id);
  if (entry) return entry.asset;
  // 无缓存:用模拟数据兜底,并触发异步拉真实数据
  const cfg = getAssetConfig(id);
  if (!cfg) return undefined;
  return simulatedAsset(cfg);
}

export function getAllAssets(): Asset[] {
  return ASSET_CONFIGS.map((cfg) => getAsset(cfg.id)!);
}

export function getAssetSlice(id: string, days: number): Asset | undefined {
  const asset = getAsset(id);
  if (!asset) return undefined;
  if (days >= asset.candles.length) return asset;
  return { ...asset, candles: asset.candles.slice(-days) };
}

// 触发某个资产的异步刷新(从真实/CSV源加载)。后台静默执行,失败不影响运行。
// 内置重试:国内接口偶发限流/空响应,重试 2 次可显著提升成功率。
export function refreshAsset(id: string): Promise<void> {
  const cfg = getAssetConfig(id);
  if (!cfg) return Promise.resolve();
  return retry(() => loadReal(cfg), 3)
    .then((candles) => {
      cache.set(id, { asset: { ...cfg, candles }, ts: Date.now(), from: 'real' });
      console.log(`📡 [${id}] 已加载真实数据 ${candles.length} 根K线`);
    })
    .catch((err) => {
      console.warn(`⚠ [${id}] 真实数据拉取失败,使用模拟数据: ${String(err.message || err).slice(0, 80)}`);
    });
}

// 后台预热:为所有标的异步加载。逐个间隔拉取(避免并发触发接口限流),
// 不阻塞服务器启动。
export function warmUpAll(): void {
  ASSET_CONFIGS.forEach((cfg, i) => {
    setTimeout(() => refreshAsset(cfg.id), i * 600); // 每个间隔 0.6s
  });
}

// 简单重试 + 退避
async function retry<T>(fn: () => Promise<T>, times: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      const result = await fn();
      if (!result || (Array.isArray(result) && result.length === 0)) {
        throw new Error('接口返回空数据(可能限流)');
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < times) await sleep(800 * attempt); // 退避:0.8s, 1.6s
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 各资产当前数据来源状态(供前端/调试查看真实 vs 模拟)
export interface AssetSourceStatus {
  id: string;
  name: string;
  symbol: string;
  source: string;          // 配置的数据源类型
  loaded: 'csv' | 'real' | 'simulated';
  candles: number;
}

export function getSourceStatus(): AssetSourceStatus[] {
  return ASSET_CONFIGS.map((cfg) => {
    const entry = cache.get(cfg.id);
    return {
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      source: cfg.source,
      loaded: entry?.from ?? 'simulated',
      candles: entry?.asset.candles.length ?? getAsset(cfg.id)?.candles.length ?? 0,
    };
  });
}

// 实际加载逻辑:CSV > 在线。模拟数据在调用方兜底。
async function loadReal(cfg: AssetConfig): Promise<Candle[]> {
  // 1) CSV 导入(最高优先级)
  const csv = loadCsvCandles(cfg.id);
  if (csv && csv.length > 10) return csv;

  // 2) 在线真实数据
  if (cfg.source === 'eastmoney_gold' && cfg.secid) {
    return fetchGoldCandles(cfg.secid);
  }
  if (cfg.source === 'eastmoney_fund' && cfg.fundCode) {
    return fetchFundCandles(cfg.fundCode);
  }

  // 3) source 本就是 simulated —— 抛错让调用方用模拟兜底
  throw new Error('该标的配置为模拟数据源');
}

function simulatedAsset(cfg: AssetConfig): Asset {
  return { ...cfg, candles: generateSimulated(cfg) };
}
