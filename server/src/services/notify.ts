// 通知中心:信号档位变化时主动推送,把"被动看板"变成"主动触达"。
//
// 核心规则(C5 通知不打扰):
// - hold 不推(观望不打扰)
// - 首次见到某资产(无历史状态):只记录基线,不推(避免首次部署刷屏)
// - 仅当 prevAction 已定义 且 与 currAction 不同 且 currAction 非 hold 才推
// - 同一 (资产,动作) 24h 内不重复推(防抖)
// - 状态落盘 signal-state.json:进程重启后不重推已发过的信号
//
// 组合模式(有持仓时):
// - 只扫描持仓标的,不推未持有资产(减少噪音)
// - 卖出信号:仅当仓位 >= PORTFOLIO_SELL_MIN_WEIGHT(默认 20%) 才推
// - 买入信号:持有即推(仓位变动建议)
//
// 通道(C6):CompositeNotifier 逐通道 try/catch,失败只 warn。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDatabaseReady } from '../db/database.js';
import { listHoldings } from '../db/holdings.js';
import { scanAll } from './scan.js';
import { buildPortfolioSummary, type PortfolioItem } from './portfolio.js';
import type { AssetRadarItem } from '../types.js';

export interface Notification {
  assetId: string;
  name: string;
  action: 'buy' | 'sell';
  actionText: string;
  score: number;
  price: number;
  changePct: number;
  reasons: string[];
  intraday?: boolean;
  /** 组合模式:仓位占比 0~1 */
  portfolioWeight?: number;
  /** 组合模式:附加说明行 */
  portfolioLine?: string;
}

export interface Notifier {
  name: string;
  send(n: Notification): Promise<void>;
}

export class CompositeNotifier implements Notifier {
  name = 'composite';
  constructor(private notifiers: Notifier[]) {}
  async send(n: Notification): Promise<void> {
    for (const nt of this.notifiers) {
      try {
        await nt.send(n);
      } catch (e) {
        console.warn(`⚠ [通知] 通道 ${nt.name} 发送失败: ${String((e as Error)?.message || e).slice(0, 80)}`);
      }
    }
  }
}

let defaultNotifiers: Notifier[] = [];
let defaultStateFile: string | undefined;

export function configureNotifiers(notifiers: Notifier[]): void {
  defaultNotifiers = notifiers;
}
export function configureStateFile(path: string | undefined): void {
  defaultStateFile = path;
}

/** 组合卖出推送最低仓位(0~1),可通过 PORTFOLIO_SELL_MIN_WEIGHT 覆盖 */
export function portfolioSellMinWeight(): number {
  const raw = Number(process.env.PORTFOLIO_SELL_MIN_WEIGHT);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.2;
}

interface SignalState {
  actions: Record<string, 'buy' | 'sell' | 'hold'>;
  lastSent: Record<string, number>;
}

function loadState(file?: string): SignalState {
  if (!file || !existsSync(file)) return { actions: {}, lastSent: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as SignalState;
  } catch {
    return { actions: {}, lastSent: {} };
  }
}

function saveState(state: SignalState, file?: string): void {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn(`⚠ [通知] 状态落盘失败: ${String((e as Error)?.message || e).slice(0, 80)}`);
  }
}

const DEDUP_MS = 24 * 60 * 60 * 1000;
const ACTION_TEXT = { buy: '建议买入', sell: '建议卖出' } as const;

function portfolioToRadarItem(item: PortfolioItem): AssetRadarItem {
  const label = item.accountLabel ?? item.accountKey;
  return {
    id: item.holdingKey,
    name: label === 'default' ? item.name : `${item.name} · ${label}`,
    symbol: item.symbol,
    assetClass: item.assetClass,
    price: item.price,
    changePct: item.changePct,
    signal: item.signal,
    loaded: item.loaded,
    stale: item.stale,
    lowConfidence: item.lowConfidence,
  };
}

interface NotifyContext {
  items: AssetRadarItem[];
  portfolioById: Map<string, PortfolioItem>;
  portfolioMode: boolean;
  portfolioSummaryLine?: string;
}

function resolveNotifyContext(strategyId?: string): NotifyContext {
  if (isDatabaseReady() && listHoldings().length > 0) {
    const summary = buildPortfolioSummary();
    const portfolioById = new Map(summary.items.map((i) => [i.holdingKey, i]));
    const items = summary.items.map(portfolioToRadarItem);
    const summaryLine = `组合 ${summary.holdingsCount} 只 · 加权 ${summary.weightedScore}(${summary.overallTone}) · 市值 ${summary.totalValue}`;
    return {
      items,
      portfolioById,
      portfolioMode: true,
      portfolioSummaryLine: summaryLine,
    };
  }
  return {
    items: scanAll(strategyId ?? 'goldFactor'),
    portfolioById: new Map(),
    portfolioMode: false,
  };
}

function toNotification(item: AssetRadarItem, ctx: NotifyContext): Notification {
  const pItem = ctx.portfolioById.get(item.id);
  const weight = pItem?.weight;
  const weightPct = weight !== undefined ? `${(weight * 100).toFixed(1)}%` : undefined;
  let portfolioLine: string | undefined;
  if (ctx.portfolioMode && weightPct) {
    portfolioLine = `占组合 ${weightPct}`;
    if (item.signal.action === 'sell' && weight !== undefined && weight >= portfolioSellMinWeight()) {
      portfolioLine += ' · 【重仓卖出】';
    }
    if (ctx.portfolioSummaryLine) {
      portfolioLine += ` · ${ctx.portfolioSummaryLine}`;
    }
  }

  const baseAssetId = pItem?.assetId ?? item.id;

  return {
    assetId: baseAssetId,
    name: item.name,
    action: item.signal.action as 'buy' | 'sell',
    actionText: ACTION_TEXT[item.signal.action as 'buy' | 'sell'],
    score: item.signal.score,
    price: item.intraday?.price ?? item.price,
    changePct: item.intraday?.changePct ?? item.changePct,
    reasons: item.signal.reasons.slice(0, 3),
    intraday: !!item.intraday?.isEstimate,
    portfolioWeight: weight,
    portfolioLine,
  };
}

function shouldSkipPortfolioNotify(
  item: AssetRadarItem,
  curr: 'buy' | 'sell' | 'hold',
  ctx: NotifyContext,
): boolean {
  if (!ctx.portfolioMode) return false;
  const pItem = ctx.portfolioById.get(item.id);
  if (!pItem) return true;
  if (curr === 'sell' && pItem.weight < portfolioSellMinWeight()) return true;
  return false;
}

export async function scanAndNotify(opts: {
  items?: AssetRadarItem[];
  strategyId?: string;
  notifiers?: Notifier[];
  stateFile?: string;
  now?: number;
  portfolioById?: Map<string, PortfolioItem>;
  portfolioMode?: boolean;
} = {}): Promise<{ sent: number; skipped: number; portfolioMode: boolean }> {
  const notifiers = opts.notifiers ?? defaultNotifiers;
  const stateFile = opts.stateFile ?? defaultStateFile;
  const now = opts.now ?? Date.now();

  let ctx: NotifyContext;
  if (opts.items) {
    ctx = {
      items: opts.items,
      portfolioById: opts.portfolioById ?? new Map(),
      portfolioMode: opts.portfolioMode ?? false,
    };
  } else {
    ctx = resolveNotifyContext(opts.strategyId);
  }

  if (notifiers.length === 0) {
    return { sent: 0, skipped: ctx.items.length, portfolioMode: ctx.portfolioMode };
  }

  const composite = new CompositeNotifier(notifiers);
  const state = loadState(stateFile);

  let sent = 0;
  let skipped = 0;
  for (const item of ctx.items) {
    const curr = item.signal.action;
    const prev = state.actions[item.id];

    if (prev === undefined) {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }
    if (prev === curr || curr === 'hold') {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }
    if (shouldSkipPortfolioNotify(item, curr, ctx)) {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }

    const dedupKey = `${item.id}:${curr}`;
    const last = state.lastSent[dedupKey];
    if (last && now - last < DEDUP_MS) {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }

    const n = toNotification(item, ctx);
    try {
      await composite.send(n);
      sent++;
      state.lastSent[dedupKey] = now;
    } catch {
      // CompositeNotifier 内部已 catch
    }
    state.actions[item.id] = curr;
  }

  saveState(state, stateFile);
  return { sent, skipped, portfolioMode: ctx.portfolioMode };
}
