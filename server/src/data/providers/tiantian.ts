import type { Candle } from '../../types.js';

// 天天基金历史净值接口。fundCode 为6位基金代码。
// 返回字段:FSRQ=日期, DWJZ=单位净值, JZZZL=涨跌幅%。
// 注意:该接口单页最多返回 20 条(pageSize 超过会被静默置空),
// 且 pageSize>=300 会返回空。因此采用分页拉取。
// 基金只有收盘净值,合成 open=high=low=close=单位净值的"净值K线"。
const LSJZ_URL = 'http://api.fund.eastmoney.com/f10/lsjz';
const PAGE_SIZE = 20;
const TARGET_RECORDS = 600; // 约2年半日净值
const MAX_PAGES = Math.ceil(TARGET_RECORDS / PAGE_SIZE);

export async function fetchFundCandles(fundCode: string): Promise<Candle[]> {
  const headers = {
    Referer: 'http://fund.eastmoney.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  const collected: any[] = [];
  let pageIndex = 1;

  for (; pageIndex <= MAX_PAGES; pageIndex++) {
    const url =
      `${LSJZ_URL}?fundCode=${encodeURIComponent(fundCode)}`
      + `&pageIndex=${pageIndex}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`天天基金接口返回 ${res.status}`);
    const json: any = await res.json();
    const list: any[] | undefined = json?.Data?.LSJZList;
    if (!list || list.length === 0) break; // 没有更多数据
    collected.push(...list);
    if (list.length < PAGE_SIZE) break; // 最后一页
  }

  if (collected.length === 0) throw new Error(`基金 ${fundCode} 无净值数据`);

  // 接口返回按日期倒序(最新在前),翻成正序(老→新)
  return collected
    .map((r) => {
      const nav = Number(r.DWJZ);
      return {
        date: r.FSRQ,
        open: nav,
        close: nav,
        high: nav,
        low: nav,
        volume: 0, // 公募基金无日成交量
      } as Candle;
    })
    .reverse();
}
