import type { Asset, AssetConfig, AssetClass, Candle, IntradaySnapshot } from '../types.js';
import { ASSET_CONFIGS, getAssetConfig } from './assets.js';
import { generateSimulated } from './simulator.js';
import { fetchGoldCandles, fetchGoldQuote } from './providers/eastmoney.js';
import { fetchSinaFuturesCandles } from './providers/sina.js';
import { enrichGoldCandles } from './goldFactors.js';
import { fetchFundCandles } from './providers/tiantian.js';
import { fetchFundEstimate } from './providers/fundgz.js';
import { loadCsvCandles } from './providers/csv.js';
import { loadCandles, saveCandles, getLatestDate } from '../db/candles.js';
import { isDatabaseReady } from '../db/database.js';

// au9999 东方财富行情接口被反爬封锁时的近似兜底:用新浪 AU0(沪金期货主力连续)。
// 走势与 au9999 现货高度同步,基差通常几元/克。映射 au9999 → AU0 期货主力代码。
// 仅 au9999 启用(ag9999/pt9995 新浪无对应主力连续代码,保持原行为走模拟兜底)。
const GOLD_PROXY_SINA: Record<string, string> = { au9999: 'AU0' };
export const GOLD_PROXY_NOTE = '沪金期货主力近似';

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
  proxyNote?: string;          // C1:近似数据源说明(如"沪金期货主力近似"),非空时前端标橙
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
    .then(async ({ candles, usedProvider, proxyNote }) => {
      const intraday = await fetchSnapshot(cfg).catch(() => null);
      const lastDate = candles.at(-1)?.date ?? '';
      const stale = isStale(lastDate, cfg.assetClass);
      cache.set(id, {
        asset: { ...cfg, candles }, ts: Date.now(), from: 'real',
        usedProvider, intraday: intraday ?? undefined, stale, proxyNote,
      });
      console.log(
        `📡 [${id}] 已加载真实数据 ${candles.length} 根K线 (源:${usedProvider}${intraday ? ` +快照:${intraday.source}` : ''}${proxyNote ? ` 近似:${proxyNote}` : ''})` +
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
  proxyNote?: string;
} | undefined {
  const e = cache.get(id);
  if (!e) return undefined;
  return { loaded: e.from, usedProvider: e.usedProvider, intraday: e.intraday, stale: e.stale, proxyNote: e.proxyNote };
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
  proxyNote?: string;      // C1:近似数据源说明
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
      proxyNote: entry?.proxyNote,
    };
  });
}

// 实际加载逻辑:CSV > SQLite 历史 + 在线增量。模拟数据在调用方兜底。
// SQLite 存历史日线(immutable),启动/刷新时读库 + 只增量抓 beg=lastDate 之后的最新。
// 增量抓到的最新一两日 upsert 回库(覆盖修正)。模拟数据不入库。
// 返回命中的历史源,供上层标注 usedProvider。proxyNote 非空表示用了近似数据源(C1)。
async function loadReal(cfg: AssetConfig): Promise<{ candles: Candle[]; usedProvider: string; proxyNote?: string }> {
  // 1) CSV 导入(最高优先级,不入库 —— 文件改动立即生效)
  const csv = loadCsvCandles(cfg.id);
  if (csv && csv.length > 10) return { candles: csv, usedProvider: 'csv' };

  // 2) 在线真实数据(SQLite 历史 + 增量抓取)
  if (cfg.source === 'eastmoney_gold' && cfg.secid) {
    const cached = loadCandles(cfg.id);
    const beg = cached.length > 0 ? getLatestDate(cfg.id)! : undefined;
    if (cached.length > 0) console.log(`📚 [${cfg.id}] 读库 ${cached.length} 根历史, 增量抓 beg=${beg}`);
    try {
      const fresh = await fetchGoldCandles(cfg.secid, 600, beg);
      console.log(`📥 [${cfg.id}] 增量抓取 ${fresh.length} 根 (源: eastmoney_gold)`);
      const merged = mergeCandles(cached, fresh);
      const candles = cfg.assetClass === 'metal' ? await enrichGoldCandles(merged) : merged;
      // 回写 SQLite(只写增量抓到的最新部分,避免重写全量)
      if (isDatabaseReady()) saveCandles(cfg.id, fresh, 'eastmoney_gold');
      return { candles, usedProvider: 'eastmoney_gold' };
    } catch (emErr) {
      // 东方财富行情接口反爬/不可达时的近似兜底:新浪 AU0 沪金期货主力连续。
      // 仅对 au9999 启用(ag9999/pt9995 新浪无对应主力连续代码,抛错走模拟兜底)。
      const sinaSymbol = GOLD_PROXY_SINA[cfg.id];
      if (sinaSymbol) {
        try {
          const fresh = await fetchSinaFuturesCandles(sinaSymbol, 600, beg);
          console.log(`📥 [${cfg.id}] 增量抓取 ${fresh.length} 根 (源: sina_au0_proxy)`);
          const merged = mergeCandles(cached, fresh);
          const candles = cfg.assetClass === 'metal' ? await enrichGoldCandles(merged) : merged;
          if (isDatabaseReady()) saveCandles(cfg.id, fresh, 'sina_au0_proxy');
          console.warn(`⚠ [${cfg.id}] 东方财富失败,回退新浪 ${sinaSymbol} 近似: ${String((emErr as Error).message || emErr).slice(0, 60)}`);
          return { candles, usedProvider: 'sina_au0_proxy', proxyNote: GOLD_PROXY_NOTE };
        } catch (sinaErr) {
          // 新浪也失败(含增量无新数据):有 SQLite 历史就回退历史,否则抛错走模拟
          if (cached.length > 0) {
            const candles = cfg.assetClass === 'metal' ? await enrichGoldCandles(cached) : cached;
            console.warn(`⚠ [${cfg.id}] 东财+新浪均失败,回退 SQLite 历史 ${cached.length} 根: ${String((sinaErr as Error).message || sinaErr).slice(0, 60)}`);
            return { candles, usedProvider: 'sqlite_history' };
          }
          throw sinaErr;
        }
      }
      // 无新浪兜底但 SQLite 有历史 → 返回历史(虽不新鲜但优于模拟)
      if (cached.length > 0) {
        const candles = cfg.assetClass === 'metal' ? await enrichGoldCandles(cached) : cached;
        console.warn(`⚠ [${cfg.id}] 东方财富失败且无新浪兜底,回退 SQLite 历史 ${cached.length} 根`);
        return { candles, usedProvider: 'sqlite_history' };
      }
      throw emErr;
    }
  }
  if (cfg.source === 'eastmoney_fund' && cfg.fundCode) {
    const cached = loadCandles(cfg.id);
    const beg = cached.length > 0 ? getLatestDate(cfg.id)! : undefined;
    if (cached.length > 0) console.log(`📚 [${cfg.id}] 读库 ${cached.length} 根历史, 增量抓 beg=${beg}`);
    try {
      const fresh = await fetchFundCandles(cfg.fundCode, beg);
      console.log(`📥 [${cfg.id}] 增量抓取 ${fresh.length} 根 (源: eastmoney_fund)`);
      const merged = mergeCandles(cached, fresh);
      if (isDatabaseReady()) saveCandles(cfg.id, fresh, 'eastmoney_fund');
      return { candles: merged, usedProvider: 'eastmoney_fund' };
    } catch (fundErr) {
      // 基金接口失败:有 SQLite 历史就回退历史,否则抛错走模拟
      if (cached.length > 0) {
        console.warn(`⚠ [${cfg.id}] 天天基金失败,回退 SQLite 历史 ${cached.length} 根: ${String((fundErr as Error).message || fundErr).slice(0, 60)}`);
        return { candles: cached, usedProvider: 'sqlite_history' };
      }
      throw fundErr;
    }
  }

  // 3) source 本就是 simulated —— 抛错让调用方用模拟兜底
  throw new Error('该标的配置为模拟数据源');
}

// 合并:历史(库) immutable + 增量(新抓)按 date upsert。
// 增量可能包含 beg 当天(修正)及之后新日期。同 date 以新抓为准。
function mergeCandles(cached: Candle[], fresh: Candle[]): Candle[] {
  if (fresh.length === 0) return cached;
  if (cached.length === 0) return fresh;
  const byDate = new Map(cached.map((c) => [c.date, c]));
  for (const f of fresh) byDate.set(f.date, f); // 增量覆盖
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function simulatedAsset(cfg: AssetConfig): Asset {
  return { ...cfg, candles: generateSimulated(cfg) };
}
