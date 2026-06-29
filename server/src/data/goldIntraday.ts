// 黄金日内/夜盘分时 —— 只展示给人看,不进信号分数,不进回测(C3/C4 不受影响)。
//
// 数据源:东方财富 118.au9999 + klt=1(1 分钟线),已验证可达,覆盖夜盘 20:00-02:30 + 日盘 09:00-15:30。
// 呼应 Gemini 战情简报里的「VWAP 分水岭 / 夜盘监控 / 盘中战术观测点」。
//
// 会话划分(上海黄金交易所 Au99.99 交易时段):
//   夜盘 20:00-02:30(跨午夜)  日盘 09:00-11:30 / 13:30-15:30
//   一个完整会话从某日 20:00 起 → 次日 15:30 结束。取最近一个 20:00 起的切片算 VWAP/区间。
//
// VWAP = Σ(收盘×成交量) / Σ(成交量) —— 日内分水岭,价格在上方偏强、下方偏弱。
import type { Candle } from '../types.js';

const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const TTL_MS = 60 * 1000; // 1 分钟缓存(分时变化快)

export interface IntradayBar {
  dt: string;     // YYYY-MM-DD HH:MM
  hour: number;
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

export interface GoldIntraday {
  preClose: number;       // 前收(昨结)
  current: number;        // 最新价
  vwap: number;           // 日内 VWAP 分水岭
  distVwap: number;       // 距 VWAP(元/克)
  distVwapPct: number;    // 距 VWAP %
  sessionPhase: '夜盘' | '日盘' | '休市';
  sessionHigh: number;
  sessionLow: number;
  night: {
    open: number; high: number; low: number; close: number;
    chgPct: number;   // 夜盘收盘 vs 前收
    hasData: boolean;
  };
  day: {
    high: number; low: number; open: number;
    hasData: boolean;
  };
  barsCount: number;
  ts: number;
  source: string;
}

// —— 纯函数:从 1 分钟 bar 切片算日内指标。便于离线测试。 ——
export function computeIntraday(bars: IntradayBar[], preClose: number): Omit<GoldIntraday, 'ts' | 'source'> {
  if (bars.length === 0) {
    return emptyIntraday(preClose);
  }
  // 会话起点:最近一次从 hour<20 跳到 hour>=20 的过渡(夜盘开盘 20:00)。
  // 不能只找 hour>=20 的 bar,因为 23:00 也是 hour>=20 但不是开盘。
  let startIdx = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].hour >= 20 && bars[i - 1].hour < 20) startIdx = i;
  }
  const session = bars.slice(startIdx);

  // 夜盘/日盘分段(夜盘 20:00-02:59,日盘 09:00-15:59)
  const night = session.filter((b) => b.hour >= 20 || b.hour < 3);
  const day = session.filter((b) => b.hour >= 9 && b.hour < 16);

  // VWAP = Σ(close*vol)/Σ(vol)
  let sumPV = 0, sumV = 0;
  for (const b of session) { sumPV += b.close * b.vol; sumV += b.vol; }
  const vwap = sumV > 0 ? sumPV / sumV : session[session.length - 1].close;

  const current = session[session.length - 1].close;
  const distVwap = current - vwap;
  const distVwapPct = vwap !== 0 ? (distVwap / vwap) * 100 : 0;

  const sessionHigh = Math.max(...session.map((b) => b.high));
  const sessionLow = Math.min(...session.map((b) => b.low));

  const last = session[session.length - 1];
  const sessionPhase: GoldIntraday['sessionPhase'] =
    last.hour >= 20 || last.hour < 3 ? '夜盘' : last.hour >= 9 && last.hour < 16 ? '日盘' : '休市';

  const nightOpen = night.length > 0 ? night[0].open : NaN;
  const nightHigh = night.length > 0 ? Math.max(...night.map((b) => b.high)) : NaN;
  const nightLow = night.length > 0 ? Math.min(...night.map((b) => b.low)) : NaN;
  const nightClose = night.length > 0 ? night[night.length - 1].close : NaN;
  const nightChgPct = night.length > 0 && preClose > 0 ? ((nightClose - preClose) / preClose) * 100 : 0;

  const dayHigh = day.length > 0 ? Math.max(...day.map((b) => b.high)) : NaN;
  const dayLow = day.length > 0 ? Math.min(...day.map((b) => b.low)) : NaN;
  const dayOpen = day.length > 0 ? day[0].open : NaN;

  return {
    preClose,
    current,
    vwap,
    distVwap,
    distVwapPct,
    sessionPhase,
    sessionHigh,
    sessionLow,
    night: {
      open: nightOpen, high: nightHigh, low: nightLow, close: nightClose,
      chgPct: nightChgPct, hasData: night.length > 0,
    },
    day: { high: dayHigh, low: dayLow, open: dayOpen, hasData: day.length > 0 },
    barsCount: session.length,
  };
}

function emptyIntraday(preClose: number): Omit<GoldIntraday, 'ts' | 'source'> {
  return {
    preClose, current: NaN, vwap: NaN, distVwap: NaN, distVwapPct: 0,
    sessionPhase: '休市', sessionHigh: NaN, sessionLow: NaN,
    night: { open: NaN, high: NaN, low: NaN, close: NaN, chgPct: 0, hasData: false },
    day: { high: NaN, low: NaN, open: NaN, hasData: false },
    barsCount: 0,
  };
}

// 解析东方财富 1 分钟 kline 响应为 IntradayBar[]
export function parseIntradayKlines(json: any): { bars: IntradayBar[]; preClose: number } {
  const klines: string[] | undefined = json?.data?.klines;
  const preClose = Number(json?.data?.preKPrice ?? NaN);
  if (!klines || klines.length === 0) throw new Error('au9999 无分时数据');
  const bars: IntradayBar[] = klines.map((line) => {
    const f = line.split(',');
    const dt = String(f[0]);
    const m = dt.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
    const hour = m ? Number(m[2]) : 0;
    const minute = m ? Number(m[3]) : 0;
    return {
      dt,
      hour, minute,
      open: Number(f[1]), close: Number(f[2]),
      high: Number(f[3]), low: Number(f[4]),
      vol: Number(f[5]),
    };
  }).filter((b) => Number.isFinite(b.close));
  return { bars, preClose };
}

let cache: { ts: number; data: GoldIntraday } | null = null;

export async function getGoldIntraday(): Promise<GoldIntraday> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data;
  const url = `${KLINE_URL}?secid=118.au9999&klt=1&fqt=0&beg=0&end=300001&lmt=900`
    + `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`au9999 分时 HTTP ${res.status}`);
  const { bars, preClose } = parseIntradayKlines(JSON.parse(await res.text()));
  const core = computeIntraday(bars, Number.isFinite(preClose) ? preClose : (bars[0]?.close ?? 0));
  const data: GoldIntraday = { ...core, ts: Date.now(), source: '东方财富 118.au9999 klt=1' };
  cache = { ts: Date.now(), data };
  return data;
}

// 供数据层复用:把 1 分钟 bar 转成日线 Candle(按日聚合),未来夜盘汇总可用。
export function aggregateToDaily(bars: IntradayBar[]): Candle[] {
  const map = new Map<string, IntradayBar[]>();
  for (const b of bars) {
    const d = b.dt.slice(0, 10);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(b);
  }
  const out: Candle[] = [];
  for (const [date, arr] of map) {
    arr.sort((a, b) => a.dt < b.dt ? -1 : 1);
    out.push({
      date,
      open: arr[0].open,
      close: arr[arr.length - 1].close,
      high: Math.max(...arr.map((x) => x.high)),
      low: Math.min(...arr.map((x) => x.low)),
      volume: arr.reduce((s, x) => s + x.vol, 0),
    });
  }
  return out;
}
