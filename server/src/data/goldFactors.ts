import type { Candle } from '../types.js';
import { browserHeaders } from './providers/_headers.js';
import { loadFactors, saveFactors, getLatestFactorDate, type FactorRow } from '../db/candles.js';
import { isDatabaseReady } from '../db/database.js';

// 黄金多因子历史数据(ChatGPT/Gemini 核心建议的"黄金定价拆解"驱动因子)。
//
// Au99.99 ≈ XAU/USD × USD/CNH + 国内溢价
//   - 国际金价 XAU/USD(新浪国际期货日线,2006 起)
//   - 汇率 USD/CNH(东方财富 133.USDCNH 日线,2010 起)
//   - 美元指数 DXY(东方财富 100.UDI 日线,2010 起)—— 国际背景,与 XAU 负相关
//   - 国内溢价 = au_close - xau*cnh/31.1035(人民币/克)—— 国内供需强弱
//
// 这些因子现已进入 goldFactor 策略评分(不再是"背景参考")。
// 全部为客观数值 + 历史序列,可回测,不破坏 C3(确定性)/C4(可回测)。
// LLM 情绪/事件日历等模糊判断仍不进分数(无法回测)。

export interface FactorDaily {
  date: string; // YYYY-MM-DD
  close: number;
}

// 1 盎司 = 31.1035 克。XAU 报价是美元/盎司,乘以 USD/CNH 再除以 31.1035
// 得到人民币/克的隐含金价,与 au9999(人民币/克)同口径,差值即国内溢价。
const GRAM_PER_OUNCE = 31.1035;

// —— 纯函数:把三条因子序列前向填充对齐到 au9999 的每个交易日 ——
// 前向填充:au 交易日 D 用"不超过 D 的最近一个因子交易日"的收盘值。
// 这样周末/假期错位不会漏值,且只用历史(无未来泄漏,回测安全)。
export function alignFactors(
  candles: Candle[],
  xau: FactorDaily[],
  cnh: FactorDaily[],
  dxy: FactorDaily[],
  comex: FactorDaily[] = [],
): Candle[] {
  const xauMap = sortByDate(xau);
  const cnhMap = sortByDate(cnh);
  const dxyMap = sortByDate(dxy);
  const comexMap = sortByDate(comex);

  return candles.map((c) => {
    const x = floorValue(xauMap, c.date);
    const h = floorValue(cnhMap, c.date);
    const d = floorValue(dxyMap, c.date);
    if (x == null || h == null) return c; // 缺国际金/汇率 → 无法算溢价,整根不加因子
    const premium = c.close - (x * h) / GRAM_PER_OUNCE;
    const cm = floorValue(comexMap, c.date) ?? undefined;
    return { ...c, xau: x, cnh: h, dxy: d ?? undefined, premium, comex: cm };
  });
}

function sortByDate(arr: FactorDaily[]): FactorDaily[] {
  return arr.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// 在按 date 升序的数组里找"不超过 target 的最后一个"收盘值(前向填充)。
function floorValue(arr: FactorDaily[], target: string): number | null {
  // 二分找右边界
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date <= target) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? arr[ans].close : null;
}

// —— 解析器(纯函数,便于测试) ——
export function parseXauJsonp(text: string): FactorDaily[] {
  const m = text.match(/var_[A-Za-z]+\((.*)\)/s);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]) as Array<{ date: string; close: string }>;
    return arr
      .map((x) => ({ date: x.date, close: Number(x.close) }))
      .filter((x) => Number.isFinite(x.close) && x.close > 0);
  } catch {
    return [];
  }
}

export function parseEmKlines(json: unknown): FactorDaily[] {
  const klines = (json as { data?: { klines?: string[] } })?.data?.klines;
  if (!Array.isArray(klines)) return [];
  // 东财格式: "日期,开,收,高,低,量"
  return klines
    .map((line) => {
      const [date, , close] = line.split(',');
      return { date, close: Number(close) };
    })
    .filter((x) => Number.isFinite(x.close) && x.close > 0);
}

// —— 抓取(带 24h 内存缓存:日线数据日内不变) + SQLite 持久化(跨重启复用历史) ——
const DAY_MS = 24 * 3600 * 1000;
interface Cached { ts: number; data: FactorDaily[]; }
const cache = new Map<string, Cached>();

// 统一:读 SQLite 历史 + 增量抓 beg=latestDate + 回写。内存 24h 缓存避免短时重复读库/抓取。
async function fetchFactorSeries(
  series: 'xau' | 'cnh' | 'dxy' | 'comex',
  fetcher: (beg?: string) => Promise<FactorDaily[]>,
): Promise<FactorDaily[]> {
  const hit = cache.get(series);
  if (hit && Date.now() - hit.ts < DAY_MS) return hit.data;

  // 读 SQLite 历史
  const cached: FactorDaily[] = isDatabaseReady() ? loadFactors(series).map((r: FactorRow) => ({ date: r.date, close: r.close })) : [];
  const beg = cached.length > 0 ? getLatestFactorDate(series)! : undefined;

  let fresh: FactorDaily[] = [];
  try {
    fresh = await fetcher(beg);
  } catch (e) {
    // 抓取失败:有历史就用历史,无历史返回空(enrichGoldCandles 会回退纯 grid)
    console.warn(`⚠ [factor:${series}] 抓取失败: ${String((e as Error).message || e).slice(0, 60)}`);
    if (cached.length > 0) {
      if (!hit) cache.set(series, { ts: Date.now(), data: cached });
      return cached;
    }
    return [];
  }

  // 合并:历史 immutable + 增量 upsert
  const merged = mergeFactors(cached, fresh);
  // 回写 SQLite(只写增量)
  if (isDatabaseReady() && fresh.length > 0) {
    try { saveFactors(series, fresh); }
    catch (e) { console.warn(`⚠ [factor:${series}] SQLite 写失败: ${String((e as Error).message || e).slice(0, 60)}`); }
  }
  if (merged.length > 0) cache.set(series, { ts: Date.now(), data: merged });
  return merged;
}

function mergeFactors(cached: FactorDaily[], fresh: FactorDaily[]): FactorDaily[] {
  if (fresh.length === 0) return cached;
  if (cached.length === 0) return fresh;
  const byDate = new Map(cached.map((c) => [c.date, c]));
  for (const f of fresh) byDate.set(f.date, f);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function fetchXauDaily(): Promise<FactorDaily[]> {
  return fetchFactorSeries('xau', async (beg) => {
    // 新浪无 beg 参数,拉全量后过滤(XAU 序列不大)
    const url = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_XAU/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU&_=';
    const res = await fetch(url, { headers: browserHeaders('https://finance.sina.com.cn/') });
    if (!res.ok) return [];
    const text = await res.text();
    const all = parseXauJsonp(text);
    return beg ? all.filter((x) => x.date >= beg) : all;
  });
}

export async function fetchCnhDaily(): Promise<FactorDaily[]> {
  return fetchFactorSeries('cnh', async (beg) => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const begParam = beg ? beg.replace(/-/g, '') : '20100101';
    const lmt = beg ? 30 : 5000;
    const url =
      'https://push2his.eastmoney.com/api/qt/stock/kline/get'
      + '?secid=133.USDCNH&klt=101&fqt=0&beg=' + begParam + '&end=' + today
      + `&lmt=${lmt}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56`
      + '&ut=fa5fd1943c7b386f172d6893dbbd1';
    const res = await fetch(url, { headers: browserHeaders('https://quote.eastmoney.com/') });
    if (!res.ok) return [];
    return parseEmKlines(await res.json());
  });
}

export async function fetchDxyDaily(): Promise<FactorDaily[]> {
  return fetchFactorSeries('dxy', async (beg) => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const begParam = beg ? beg.replace(/-/g, '') : '20100101';
    const lmt = beg ? 30 : 5000;
    const url =
      'https://push2his.eastmoney.com/api/qt/stock/kline/get'
      + '?secid=100.UDI&klt=101&fqt=0&beg=' + begParam + '&end=' + today
      + `&lmt=${lmt}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56`
      + '&ut=fa5fd1943c7b386f172d6893dbbd1';
    const res = await fetch(url, { headers: browserHeaders('https://quote.eastmoney.com/') });
    if (!res.ok) return [];
    return parseEmKlines(await res.json());
  });
}

// COMEX 黄金库存(吨)—— 东财数据中心 RPT_FUTUOPT_GOLDSIL 接口,黄金 INDICATOR_ID1=EMI00069026。
// 慢变量(日变化通常<1%),库存升=利空金价(交割流入压力),库存降=利多(实物提取需求强)。
// 接口无反爬(curl 直连可拿 JSON),仍带 browserHeaders 保险。日频,~24 年历史。
export function parseComexJson(json: unknown): FactorDaily[] {
  const rows = (json as { result?: { data?: Array<{ REPORT_DATE: string; STORAGE_TON: string | number | null }> } })?.result?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => {
      const date = (r.REPORT_DATE || '').slice(0, 10); // "2026-06-25 00:00:00" → "2026-06-25"
      const ton = Number(r.STORAGE_TON);
      return { date, close: ton };
    })
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.close) && x.close > 0);
}

export async function fetchComexInventory(): Promise<FactorDaily[]> {
  return fetchFactorSeries('comex', async (beg) => {
    // 接口按 REPORT_DATE 倒序返回。filter 必须是单一字符串(多个条件用 () 串联)。
    // 全量:pageSize=500 分页直到末页。增量:加 REPORT_DATE>=beg 只拉新数据。
    const goldFilter = '(INDICATOR_ID1%3D%22EMI00069026%22)(STORAGE_TON%3C%3E%22NULL%22)';
    const headers = browserHeaders('https://data.eastmoney.com/pmetal/comex/hj.html');

    if (beg) {
      const filter = goldFilter + `(REPORT_DATE%3E%3D%27${beg}%27)`;
      const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
        + `?reportName=RPT_FUTUOPT_GOLDSIL&columns=ALL&sortColumns=REPORT_DATE&sortTypes=-1`
        + `&filter=${filter}&pageNumber=1&pageSize=50`;
      const res = await fetch(url, { headers });
      if (!res.ok) return [];
      return parseComexJson(await res.json());
    }

    // 全量分页拉取
    const all: FactorDaily[] = [];
    for (let page = 1; page <= 30; page++) {
      const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
        + `?reportName=RPT_FUTUOPT_GOLDSIL&columns=ALL&sortColumns=REPORT_DATE&sortTypes=-1`
        + `&filter=${goldFilter}&pageNumber=${page}&pageSize=500`;
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const rows = parseComexJson(await res.json());
      if (rows.length === 0) break;
      all.push(...rows);
      if (rows.length < 500) break; // 末页
    }
    // 去重 + 升序
    const byDate = new Map(all.map((r) => [r.date, r]));
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  });
}

// best-effort:把 au9999 日线 enrichment 上因子。任一源失败则原样返回
// (goldFactor 策略检测到因子缺失会自动回退纯 grid 逻辑,不影响可用性)。
export async function enrichGoldCandles(candles: Candle[]): Promise<Candle[]> {
  try {
    const [xau, cnh, dxy, comex] = await Promise.all([
      fetchXauDaily(), fetchCnhDaily(), fetchDxyDaily(), fetchComexInventory(),
    ]);
    if (xau.length === 0 || cnh.length === 0) return candles;
    return alignFactors(candles, xau, cnh, dxy, comex);
  } catch {
    return candles;
  }
}
