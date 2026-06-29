import type { Candle } from '../../types.js';

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
