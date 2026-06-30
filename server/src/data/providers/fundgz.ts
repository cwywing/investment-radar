import type { IntradaySnapshot } from '../../types.js';
import { browserHeaders } from './_headers.js';

// 天天基金盘中估值接口(已验证 2026-06-29)。
// 返回 jsonpgz({...}); 包裹。gsz=盘中估值,gszzl=相对昨收涨跌%,gztime=估值时间。
// 注意:gsz 是估算值(未确认净值),isEstimate=true,不可注入策略 K 线序列。
// 非交易时段返回的 gsz 通常等于 dwjz(最近净值),gztime 为空或为上次交易时段。
// 反爬:必须带 Referer(fund.eastmoney.com),否则可能拒绝。加拟人化 UA 保持稳定。
const FUNDGZ_URL = 'https://fundgz.1234567.com.cn/js';

export async function fetchFundEstimate(fundCode: string): Promise<IntradaySnapshot | null> {
  const url = `${FUNDGZ_URL}/${encodeURIComponent(fundCode)}.js`;
  const res = await fetch(url, {
    headers: browserHeaders('https://fund.eastmoney.com/'),
  });
  if (!res.ok) return null;
  const text = await res.text();
  // 提取 jsonpgz({...}) 中的 JSON
  const m = text.match(/jsonpgz\((.+)\)/);
  if (!m) return null;
  let json: any;
  try {
    json = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const price = Number(json?.gsz);
  const changePct = Number(json?.gszzl);
  if (!Number.isFinite(price)) return null;
  return {
    price,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    time: String(json?.gztime || ''),
    source: 'fundgz',
    isEstimate: true,
  };
}
