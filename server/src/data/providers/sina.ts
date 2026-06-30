import type { Candle } from '../../types.js';
import { browserHeaders } from './_headers.js';

// 新浪财经期货日线 K 线接口。symbol 形如 AU0(沪金主力连续)、AG0(白银主力)、CU0(铜主力)。
// 返回 JSONP: `/*<script>...*/var_([{d,o,h,l,c,v,p,s},...])`。
// 字段: d=YYYY-MM-DD, o=开, h=高, l=低, c=收, v=成交量。
// 用于东方财富黄金行情接口被反爬封锁时的兜底 —— AU0(沪金期货主力连续)走势与
// au9999(上海金交所现货 9999)高度同步,基差通常仅几元/克,作为信号源可接受,
// 但必须在上层标注 proxyNote(数据源语义诚实,C1)。
// 反爬:新浪校验 Referer + UA,缺 Referer 或机器 UA 会拒绝/限流。
const KLINE_URL = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_/InnerFuturesNewService.getDailyKLine';

export async function fetchSinaFuturesCandles(symbol: string, days = 600, beg?: string): Promise<Candle[]> {
  const url = `${KLINE_URL}?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: browserHeaders('https://finance.sina.com.cn/'),
  });
  if (!res.ok) throw new Error(`新浪期货接口返回 ${res.status}`);
  const text = await res.text();
  // 提取 var_(...JSON...) 中的 JSON 数组(允许空数组 [],由后续长度检查抛错)
  const m = text.match(/var_\((\[[\s\S]*\])\)/);
  if (!m) throw new Error(`${symbol} 新浪接口响应格式异常(无 var_ 包裹)`);
  const arr: SinaKLine[] = JSON.parse(m[1]);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error(`${symbol} 新浪接口无K线数据`);

  // 增量:beg 非空时只取 d >= beg(SinaKLine.d 是日期字段;重抓 beg 当天 + 之后,用于修正最新一两日)。
  // 全量:取最后 days 根。
  const filtered = beg ? arr.filter((k) => k.d >= beg) : arr.slice(-days);
  if (filtered.length === 0) throw new Error(`${symbol} 新浪接口增量无新数据(beg=${beg})`);
  return filtered.map((k) => ({
    date: k.d,
    open: num(k.o),
    high: num(k.h),
    low: num(k.l),
    close: num(k.c),
    volume: Math.round(Number(k.v) || 0),
  }));
}

interface SinaKLine {
  d: string;  // 日期 YYYY-MM-DD
  o: string;  // 开
  h: string;  // 高
  l: string;  // 低
  c: string;  // 收
  v: string;  // 成交量
  p?: string; // 持仓量
  s?: string;
}

function num(s: string): number {
  return Math.round(Number(s) * 10000) / 10000;
}
