import type { Asset, AssetConfig, AssetClass, Candle, IntradaySnapshot } from '../types.js';
import { ASSET_CONFIGS, getAssetConfig } from './assets.js';
import { generateSimulated } from './simulator.js';
import { fetchGoldCandles, fetchGoldQuote } from './providers/eastmoney.js';
import { enrichGoldCandles } from './goldFactors.js';
import { fetchFundCandles } from './providers/tiantian.js';
import { fetchFundEstimate } from './providers/fundgz.js';
import { loadCsvCandles } from './providers/csv.js';

// 三级数据源架构,优先级:CSV导入 > 在线真实数据 > 模拟数据。
// 上层(getAsset / getAllAssets)接口保持不变,策略与前端零改动。
//
// 快照(盘中估值/实时价)单独存储,不并入 candles —— 估值 ≠ 收盘净值,
// 注入会污染 MA/MACD/回测。快照失败不影响主流程(best-effort)。

// C2 数据新鲜度校验:最新 K 线日期若过于陈旧,视为过期(数据源可能卡住/接口异常)。
// 阈值保守(基金 8 天、黄金 9 天),覆盖最长假期(国庆 7 天)+缓冲,避免长假误报。
// 严格"滞后不超过 1 个交易日"需逐交易日判定,这里先用安全阈值抓真实停摆。
const STALE_DAYS: Record<AssetClass, number> = { fund: 8, metal: 9 };
export function isStale(lastDateStr: string, assetClass: AssetClass, now: Date = new Date()): boolean {
  const last = new Date(lastDateStr + 'T00:00:00Z');
  if (isNaN(last.getTime())) return true; // 日期解析失败 → 视为过期
  const days = (now.getTime() - last.getTime()) / (24 * 3600 * 1000);
  return days > STALE_DAYS[assetClass];
}

interface CacheEntry {
  asset: Asset;
  ts: number;       // 抓取时间戳
  from: 'csv' | 'real' | 'simulated';
  usedProvider: string;        // 命中的历史源
  intraday?: IntradaySnapshot; // 盘中快照(可有可无)
  stale: boolean;              // C2:最新K线是否过期
}

const TTL = 1000 * 60 * 60; // 在线数据缓存 1 小时(实时性 vs 限流的平衡)
const cache = new Map<string, CacheEntry>();

// 数据刷新事件:refreshAsset 成功更新缓存后通知订阅者。
// scan 服务订阅此事件来清回测缓存 —— 否则数据已刷新,回测仍用旧 K 线算的胜率(Phase1 隐患)。
const refreshListeners = new Set<(id: string) => void>();
export function onAssetRefresh(cb: (id: string) => void): () => void {
  refreshListeners.add(cb);
  return () => { refreshListeners.delete(cb); };
}

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
// 历史数据到位后,顺带抓盘中快照(估值/实时价),best-effort,失败不影响资产可用性。
export function refreshAsset(id: string): Promise<void> {
  const cfg = getAssetConfig(id);
  if (!cfg) return Promise.resolve();
  return retry(() => loadReal(cfg), 3)
    .then(async ({ candles, usedProvider }) => {
      const intraday = await fetchSnapshot(cfg).catch(() => null);
      const lastDate = candles.at(-1)?.date ?? '';
      const stale = isStale(lastDate, cfg.assetClass);
      cache.set(id, {
        asset: { ...cfg, candles }, ts: Date.now(), from: 'real',
        usedProvider, intraday: intraday ?? undefined, stale,
      });
      console.log(
        `📡 [${id}] 已加载真实数据 ${candles.length} 根K线 (源:${usedProvider}${intraday ? ` +快照:${intraday.source}` : ''})` +
        (stale ? ` ⚠ 最新K线${lastDate}已过期` : ''),
      );
      // 通知订阅者(如 scan 清回测缓存):数据已更新,旧派生结果应失效
      refreshListeners.forEach((cb) => cb(id));
    })
    .catch((err) => {
      console.warn(`⚠ [${id}] 真实数据拉取失败,使用模拟数据: ${String(err.message || err).slice(0, 80)}`);
    });
}

// 盘中快照:基金=估值(fundgz),黄金=实时最新价(eastmoney)。CSV/模拟 无快照。
async function fetchSnapshot(cfg: AssetConfig): Promise<IntradaySnapshot | null> {
  if (cfg.source === 'eastmoney_fund' && cfg.fundCode) return fetchFundEstimate(cfg.fundCode);
  if (cfg.source === 'eastmoney_gold' && cfg.secid) return fetchGoldQuote(cfg.secid);
  return null;
}

// 暴露单资产的运行时来源信息(供 scanAll 构造 AssetRadarItem 的 loaded/intraday/stale)。
export function getAssetSource(id: string): {
  loaded: 'csv' | 'real' | 'simulated';
  usedProvider: string;
  intraday?: IntradaySnapshot;
  stale: boolean;
} | undefined {
  const e = cache.get(id);
  if (!e) return undefined;
  return { loaded: e.from, usedProvider: e.usedProvider, intraday: e.intraday, stale: e.stale };
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
      const isEmpty = Array.isArray(result)
        ? result.length === 0
        : result && typeof result === 'object' && 'candles' in result
          ? (result as { candles: unknown[] }).candles.length === 0
          : !result;
      if (isEmpty) throw new Error('接口返回空数据(可能限流)');
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
  usedProvider: string;    // 实际命中的历史源
  intraday?: IntradaySnapshot;
  stale: boolean;          // C2:最新K线是否过期
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
      usedProvider: entry?.usedProvider ?? 'simulated',
      intraday: entry?.intraday,
      stale: entry?.stale ?? false,
      candles: entry?.asset.candles.length ?? getAsset(cfg.id)?.candles.length ?? 0,
    };
  });
}

// 实际加载逻辑:CSV > 在线。模拟数据在调用方兜底。
// 返回命中的历史源,供上层标注 usedProvider。
async function loadReal(cfg: AssetConfig): Promise<{ candles: Candle[]; usedProvider: string }> {
  // 1) CSV 导入(最高优先级)
  const csv = loadCsvCandles(cfg.id);
  if (csv && csv.length > 10) return { candles: csv, usedProvider: 'csv' };

  // 2) 在线真实数据
  if (cfg.source === 'eastmoney_gold' && cfg.secid) {
    const raw = await fetchGoldCandles(cfg.secid);
    // 黄金额外挂载多因子(XAU/CNH/DXY/溢价)到每根 K 线,best-effort:
    // 失败返回原线,goldFactor 策略自动回退纯 grid。仅对黄金有意义。
    const candles = cfg.assetClass === 'metal' ? await enrichGoldCandles(raw) : raw;
    return { candles, usedProvider: 'eastmoney_gold' };
  }
  if (cfg.source === 'eastmoney_fund' && cfg.fundCode) {
    const candles = await fetchFundCandles(cfg.fundCode);
    return { candles, usedProvider: 'eastmoney_fund' };
  }

  // 3) source 本就是 simulated —— 抛错让调用方用模拟兜底
  throw new Error('该标的配置为模拟数据源');
}

function simulatedAsset(cfg: AssetConfig): Asset {
  return { ...cfg, candles: generateSimulated(cfg) };
}
