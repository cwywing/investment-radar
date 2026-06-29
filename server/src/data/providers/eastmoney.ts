import type { Candle, IntradaySnapshot } from '../../types.js';

// 东方财富 K线接口(贵金属/ETF/股票通用)。secid 形如 118.au9999。
// 字段 f51..f56 = 日期,开,收,高,低,量; klt=101 日线。
const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

export async function fetchGoldCandles(secid: string, days = 400): Promise<Candle[]> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url =
    `${KLINE_URL}?secid=${encodeURIComponent(secid)}`
    + `&fields1=f1&fields2=f51,f52,f53,f54,f55,f56`
    + `&klt=101&fqt=0&beg=20180101&end=${today}&lmt=${days}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (radar-server)' },
  });
  if (!res.ok) throw new Error(`东方财富接口返回 ${res.status}`);
  const json: any = await res.json();
  const klines: string[] | undefined = json?.data?.klines;
  if (!klines || klines.length === 0) throw new Error(`${secid} 无K线数据`);

  // 格式: "日期,开,收,高,低,量"。合成 open/high/low/close/volume。
  return klines.map((line) => {
    const [date, open, close, high, low, volume] = line.split(',');
    return {
      date,
      open: num(open),
      close: num(close),
      high: num(high),
      low: num(low),
      volume: Math.round(Number(volume) || 0),
    };
  });
}

function num(s: string): number {
  return Math.round(Number(s) * 10000) / 10000;
}

// 东方财富实时报价接口(已验证 2026-06-29)。贵金属/ETF/股票通用。
// 字段 f43=最新价, f170=涨跌幅%, f169=涨跌额, f44=高, f45=低, f46=开。
// 用于黄金的"最新价快照"——历史 K 线仍由 fetchGoldCandles 提供,
// 这里只补一个盘中实时价(不注入 K 线序列,避免污染 MA/回测)。
const QUOTE_URL = 'https://push2.eastmoney.com/api/qt/stock/get';

export async function fetchGoldQuote(secid: string): Promise<IntradaySnapshot | null> {
  const url =
    `${QUOTE_URL}?secid=${encodeURIComponent(secid)}`
    + `&fields=f43,f170,f169,f57,f58&fltt=2`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (radar-server)' },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const d = json?.data;
  const price = Number(d?.f43);
  const changePct = Number(d?.f170);
  // 价格非正(如 ag9999/pt9995 该接口返回 f43=0)视为无有效报价,返回 null。
  // 否则前端会把白银显示成 0 元 —— 误导。无快照时前端回退显示官方收盘价。
  if (!Number.isFinite(price) || price <= 0) return null;
  // 实时接口不带时间戳字段,用本地时间标注抓取时刻
  return {
    price,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    time: new Date().toISOString().replace('T', ' ').slice(0, 16),
    source: 'eastmoney_rt',
    isEstimate: false,
  };
}
