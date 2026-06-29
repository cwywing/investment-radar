// 通知中心:信号档位变化时主动推送,把"被动看板"变成"主动触达"。
//
// 核心规则(C5 通知不打扰):
// - hold 不推(观望不打扰)
// - 首次见到某资产(无历史状态):只记录基线,不推(避免首次部署刷屏 8 条)
// - 仅当 prevAction 已定义 且 与 currAction 不同 且 currAction 非 hold 才推
// - 同一 (资产,动作) 24h 内不重复推(防抖)
// - 状态落盘 signal-state.json:进程重启后不重推已发过的信号
//
// 通道(C6 通道失败不崩):CompositeNotifier 逐通道 try/catch,任一失败只 warn,
// 不影响其他通道、不影响调度/扫描主流程。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scanAll } from './scan.js';
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
  intraday?: boolean; // 是否为盘中估值驱动的信号
}

export interface Notifier {
  name: string;
  send(n: Notification): Promise<void>;
}

// 复合通道:逐个发送,任一失败不阻断其他通道,也不抛错(C6)。
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

// ---- 模块级默认配置(由 index.ts 启动时设置)----
let defaultNotifiers: Notifier[] = [];
let defaultStateFile: string | undefined;

export function configureNotifiers(notifiers: Notifier[]): void {
  defaultNotifiers = notifiers;
}
export function configureStateFile(path: string | undefined): void {
  defaultStateFile = path;
}

// ---- 信号状态(落盘)----
interface SignalState {
  actions: Record<string, 'buy' | 'sell' | 'hold'>;     // 资产 → 上次动作
  lastSent: Record<string, number>;                      // "assetId:action" → 上次推送时间戳
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

const DEDUP_MS = 24 * 60 * 60 * 1000; // 24h 防抖
const ACTION_TEXT = { buy: '建议买入', sell: '建议卖出' } as const;

function toNotification(item: AssetRadarItem): Notification {
  return {
    assetId: item.id,
    name: item.name,
    action: item.signal.action as 'buy' | 'sell',
    actionText: ACTION_TEXT[item.signal.action as 'buy' | 'sell'],
    score: item.signal.score,
    price: item.intraday?.price ?? item.price,
    changePct: item.intraday?.changePct ?? item.changePct,
    reasons: item.signal.reasons.slice(0, 3),
    intraday: !!item.intraday?.isEstimate,
  };
}

// 扫描并推送信号变化。items 可注入(测试用),默认用 scanAll。
// 返回发送/跳过计数。绝不抛错(调度调用方安全)。
export async function scanAndNotify(opts: {
  items?: AssetRadarItem[];
  strategyId?: string;
  notifiers?: Notifier[];
  stateFile?: string;
  now?: number;
} = {}): Promise<{ sent: number; skipped: number }> {
  const notifiers = opts.notifiers ?? defaultNotifiers;
  const stateFile = opts.stateFile ?? defaultStateFile;
  const now = opts.now ?? Date.now();
  const items = opts.items ?? scanAll(opts.strategyId ?? 'goldFactor');

  if (notifiers.length === 0) {
    return { sent: 0, skipped: items.length }; // 无通道,静默跳过
  }
  const composite = new CompositeNotifier(notifiers);
  const state = loadState(stateFile);

  let sent = 0;
  let skipped = 0;
  for (const item of items) {
    const curr = item.signal.action;
    const prev = state.actions[item.id];

    // 首次见到该资产:只记基线,不推(避免首次部署刷屏)
    if (prev === undefined) {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }
    // 无变化 或 当前 hold:不推
    if (prev === curr || curr === 'hold') {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }
    // 24h 防抖:同一 (资产,动作) 近期推过则跳过
    const dedupKey = `${item.id}:${curr}`;
    const last = state.lastSent[dedupKey];
    if (last && now - last < DEDUP_MS) {
      state.actions[item.id] = curr;
      skipped++;
      continue;
    }

    // 发送
    const n = toNotification(item);
    try {
      await composite.send(n);
      sent++;
      state.lastSent[dedupKey] = now;
    } catch {
      // CompositeNotifier 内部已 catch,这里兜底以防意外
    }
    state.actions[item.id] = curr;
  }

  saveState(state, stateFile);
  return { sent, skipped };
}
