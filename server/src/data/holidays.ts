// 中国大陆交易日历(节假日写死,源自国务院办公厅通知)。
// 数据文件: server/data/holidays.json —— 由 NateScarlet/holiday-cn 抓取合成(2025-2027)。
// 含调休:isOffDay=true 的周末调休上班日仍为交易日;isOffDay=false 的休假日非交易日。
//
// 路径解析:同时兼容 dev(tsx, src/data)与 prod(dist/data)——
//   dev:  __dirname=server/src/data  -> ../../data = server/data ✓
//   prod: __dirname=server/dist/data -> ../../data = server/data ✓
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOLIDAYS_FILE = join(__dirname, '../../data/holidays.json');

interface HolidayData {
  source: string;
  years: number[];
  offDays: string[];        // 休假日(非交易日)
  extraWorkdays: string[];  // 调休上班日(周末但交易)
}

let offSet: Set<string> | null = null;
let extraSet: Set<string> | null = null;

function ensureLoaded(): void {
  if (offSet) return;
  offSet = new Set();
  extraSet = new Set();
  if (!existsSync(HOLIDAYS_FILE)) return;
  try {
    const d = JSON.parse(readFileSync(HOLIDAYS_FILE, 'utf-8')) as HolidayData;
    d.offDays.forEach((x) => offSet!.add(x));
    d.extraWorkdays.forEach((x) => extraSet!.add(x));
  } catch {
    // 解析失败:退化为仅周末判定(安全兜底)
  }
}

// 本地日期字符串(YYYY-MM-DD),用本地时区而非 UTC,避免 UTC+8 凌晨日期偏移。
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isOffDay(dateStr: string): boolean {
  ensureLoaded();
  return offSet!.has(dateStr);
}

export function isExtraWorkday(dateStr: string): boolean {
  ensureLoaded();
  return extraSet!.has(dateStr);
}

// 交易日 = 非休假日 且 (工作日 或 调休上班日)。
// 未在 holidays.json 覆盖的日期(超出 2025-2027 范围):退化为周末判定。
export function isTradingDay(d: Date): boolean {
  const ds = localDateStr(d);
  if (isOffDay(ds)) return false;
  if (isExtraWorkday(ds)) return true;
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

// 调试用:已加载的年份范围
export function holidayYears(): number[] {
  ensureLoaded();
  if (!existsSync(HOLIDAYS_FILE)) return [];
  try {
    return (JSON.parse(readFileSync(HOLIDAYS_FILE, 'utf-8')) as HolidayData).years;
  } catch {
    return [];
  }
}
