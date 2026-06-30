// 轻量调度器:在交易日关键时点主动刷新数据,而非傻等 1h TTL。
// 基金净值在收盘后才陆续发布(约 20:00–22:00);黄金有夜盘(到次日凌晨 02:30)。
//
// 交易日判定:用 server/data/holidays.json(国务院通知,含调休),不再仅靠周末。
// 服务器时区需为 UTC+8(已确认 Asia/Shanghai)。
//
// 设计:planRefresh 是纯函数(给定时刻 → 该刷哪些资产),便于测试;
// startScheduler 是有状态包装(每分钟 tick + 同一分钟去重 + 调 refreshAsset)。
import { ASSET_CONFIGS, type AssetConfig } from './data/assets.js';
import { refreshAsset } from './data/dataProvider.js';
import { isTradingDay } from './data/holidays.js';
import { scanAndNotify } from './services/notify.js';

export { isTradingDay }; // 重新导出,供测试/外部使用

interface SchedulePoint {
  hour: number;
  minute: number;
  filter?: (cfg: AssetConfig) => boolean; // 默认全部资产
  label: string;
}

// 调度表(UTC+8 本地时间):
// - 15:30 收盘后,全资产刷一次(基金净值开始发布,黄金日盘收)
// - 22:00 全资产刷一次(基金当日最终净值基本到位)
// - 02:30 次日凌晨,仅黄金(夜盘结束,拿夜盘收盘价)
// - 22:10 通知检查:扫描信号变化并推送(此时 22:00 刷新已完成,数据最新)
const SCHEDULE: SchedulePoint[] = [
  { hour: 15, minute: 30, label: '收盘后' },
  { hour: 22, minute: 0, label: '最终净值' },
  { hour: 2, minute: 30, filter: (c) => c.assetClass === 'metal', label: '黄金夜盘收' },
];

const NOTIFY_AT = { hour: 22, minute: 10 };

// 纯函数:给定时刻是否该刷新,该刷哪些资产。无匹配/非交易日返回 null。
export function planRefresh(now: Date): { ids: string[]; label: string } | null {
  if (!isTradingDay(now)) return null;
  const hh = now.getHours();
  const mm = now.getMinutes();
  const point = SCHEDULE.find((s) => s.hour === hh && s.minute === mm);
  if (!point) return null;
  const targets = ASSET_CONFIGS.filter(point.filter ?? (() => true));
  return { ids: targets.map((c) => c.id), label: point.label };
}

// 纯函数:给定时刻是否该做通知检查。
export function planNotify(now: Date): boolean {
  if (!isTradingDay(now)) return false;
  return now.getHours() === NOTIFY_AT.hour && now.getMinutes() === NOTIFY_AT.minute;
}

// 有状态:记录已触发的时点键,避免同一分钟内多次 tick 重复触发。
const firedKeys = new Set<string>();

export function startScheduler(intervalMs = 60_000): () => void {
  const tick = () => {
    const now = new Date();
    const key = (tag: string) => `${now.toDateString()} ${tag} ${now.getHours()}:${now.getMinutes()}`;

    // 1) 数据刷新
    const plan = planRefresh(now);
    if (plan && !firedKeys.has(key('refresh'))) {
      firedKeys.add(key('refresh'));
      console.log(`⏰ [调度] ${now.toTimeString().slice(0, 5)} ${plan.label},刷新 ${plan.ids.length} 个资产`);
      plan.ids.forEach((id, i) => setTimeout(() => refreshAsset(id), i * 600));
    }

    // 2) 通知检查(22:10,数据已新)
    if (planNotify(now) && !firedKeys.has(key('notify'))) {
      firedKeys.add(key('notify'));
      console.log(`⏰ [调度] ${now.toTimeString().slice(0, 5)} 通知检查`);
      // 不 await:调度 tick 不阻塞;失败内部已兜底
      scanAndNotify().then((r) => {
        if (r.portfolioMode) {
          console.log(`⏰ [调度] 组合通知模式:发送 ${r.sent} 条,跳过 ${r.skipped} 条`);
        }
      }).catch((e) => console.warn(`⚠ [通知] 扫描失败: ${String(e).slice(0, 80)}`));
    }

    if (firedKeys.size > 40) firedKeys.clear();
  };
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
