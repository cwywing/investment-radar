// 黄金定价拆解 —— 只展示给人看,不进信号分数,不进回测(C3/C4 不受影响)。
//
// 核心关系(来自 ChatGPT/Gemini 建议):Au99.99 ≈ XAU/USD × USD/CNY + 国内供需溢价
//   人民币计价国际金价 = XAU(美元/盎司) × USD/CNH ÷ 31.1035(克/盎司)
//   国内溢价 = Au99.99 − 人民币计价国际金价
//   今日 Au99.99 涨幅 ≈ 国际金价涨幅 + 人民币汇率涨幅 + 溢价变动(小量近似)
//
// 数据源(全部已验证可达):
//   XAU/USD  : 新浪 hf_XAU(伦敦金现货,index0=最新,index7=昨结)
//   USD/CNH  : 东方财富 133.USDCNH(f43=最新/1e4,f60=昨收/1e4,f170=涨跌/1e2)
//   DXY      : 东方财富 100.UDI(f43=最新/1e2,f170=涨跌/1e2)
//   Au99.99  : 本地 dataProvider 的 K 线(末根收盘=今日,前一根=昨日)
//
// 注意:用离岸 CNH 而非在岸 CNY,因 CNH 24h 交易、与 XAU 时段更对齐,
// 拆解时区更一致。Au99.99 涨幅按日 K 线算,与 CNH 日变化对齐。
const GRAM_PER_OZ = 31.1035;
const TTL_MS = 5 * 60 * 1000; // 5 分钟缓存(国际行情波动快,比新闻短)

export interface GoldDrivers {
  auPrice: number;        // Au99.99 元/克
  auPrevClose: number;
  auChgPct: number;       // Au99.99 今日涨幅 %
  xauUsd: number;         // 国际金价 美元/盎司
  xauPrevClose: number;
  xauChgPct: number;      // 国际金价涨幅 %
  usdCnh: number;         // 离岸人民币
  cnyPrevClose: number;
  cnyChgPct: number;      // 人民币涨幅 %(CNH 上涨=人民币贬值=利多人民币金价)
  dxy: number | null;     // 美元指数(快照,不参与拆解)
  dxyChgPct: number | null;
  rmbImplied: number;     // 人民币计价国际金价 元/克
  premium: number;        // 国内溢价 元/克(正=升水,负=贴水)
  premiumStatus: '正常' | '异常偏高' | '贴水倒挂';
  intlContrib: number;    // 国际金价贡献 %(=xauChgPct)
  fxContrib: number;      // 汇率贡献 %(=cnyChgPct)
  premiumContrib: number; // 溢价贡献 %(=auChgPct - xauChgPct - cnyChgPct)
  ts: number;             // 数据时间戳
  source: string;         // 数据来源标注
}

// —— 纯函数:三因子拆解。便于离线测试,不依赖网络。 ——
export function decomposeGold(
  auPrice: number, auPrevClose: number,
  xauUsd: number, xauPrevClose: number,
  usdCnh: number, cnyPrevClose: number,
): Omit<GoldDrivers, 'dxy' | 'dxyChgPct' | 'ts' | 'source'> {
  const rmbImplied = (xauUsd * usdCnh) / GRAM_PER_OZ;
  const premium = auPrice - rmbImplied;
  const auChgPct = pct(auPrice, auPrevClose);
  const xauChgPct = pct(xauUsd, xauPrevClose);
  const cnyChgPct = pct(usdCnh, cnyPrevClose);
  // (1+xau)(1+cny)(1+prem) ≈ 1+au → prem ≈ au - xau - cny(小量近似)
  const premiumContrib = auChgPct - xauChgPct - cnyChgPct;
  const premiumStatus: GoldDrivers['premiumStatus'] =
    premium > 5 ? '异常偏高' : premium < -3 ? '贴水倒挂' : '正常';
  return {
    auPrice, auPrevClose, auChgPct,
    xauUsd, xauPrevClose, xauChgPct,
    usdCnh, cnyPrevClose, cnyChgPct,
    rmbImplied, premium, premiumStatus,
    intlContrib: xauChgPct, fxContrib: cnyChgPct, premiumContrib,
  };
}

function pct(cur: number, prev: number): number {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((cur - prev) / prev) * 100;
}

// —— 解析新浪 hf_XAU ——
export function parseXau(text: string): { price: number; prevClose: number } {
  const m = text.match(/hq_str_hf_XAU="([^"]*)"/);
  if (!m) throw new Error('XAU 解析失败');
  const f = m[1].split(',');
  const price = Number(f[0]);
  const prevClose = Number(f[7]); // 昨结
  if (!Number.isFinite(price) || !Number.isFinite(prevClose)) throw new Error('XAU 字段缺失');
  return { price, prevClose };
}

// —— 解析东方财富外汇/指数 JSON(f43/f60/f170,带精度缩放) ——
export function parseEmQuote(json: any, scale: number): { price: number; prevClose: number | null; chgPct: number | null } {
  const d = json?.data;
  if (!d || d.f43 == null) throw new Error('EM 无数据');
  const price = d.f43 / scale;
  const prevClose = d.f60 != null ? d.f60 / scale : null;
  const chgPct = d.f170 != null ? d.f170 / 100 : null;
  return { price, prevClose, chgPct };
}

async function fetchXauUsd(): Promise<{ price: number; prevClose: number }> {
  const res = await fetch('https://hq.sinajs.cn/list=hf_XAU', { headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`XAU HTTP ${res.status}`);
  return parseXau(await res.text());
}

async function fetchUsdCnh(): Promise<{ price: number; prevClose: number }> {
  const res = await fetch('https://push2.eastmoney.com/api/qt/stock/get?secid=133.USDCNH&fields=f43,f60,f170&ut=fa5fd1943c7b386f172d6893dbbd1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`CNH HTTP ${res.status}`);
  const q = parseEmQuote(JSON.parse(await res.text()), 10000);
  if (q.prevClose == null) throw new Error('CNH 缺昨收');
  return { price: q.price, prevClose: q.prevClose };
}

async function fetchDxy(): Promise<{ price: number; chgPct: number }> {
  const res = await fetch('https://push2.eastmoney.com/api/qt/stock/get?secid=100.UDI&fields=f43,f60,f170&ut=fa5fd1943c7b386f172d6893dbbd1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`DXY HTTP ${res.status}`);
  const q = parseEmQuote(JSON.parse(await res.text()), 100);
  return { price: q.price, chgPct: q.chgPct ?? 0 };
}

let cache: { ts: number; data: GoldDrivers } | null = null;

// 取黄金定价拆解。auPrice/auPrevClose 由调用方从本地 K 线传入。
// 任一外部源失败时:若缓存未过期则返回缓存,否则抛错(由路由兜底 500→空)。
export async function getGoldDrivers(auPrice: number, auPrevClose: number): Promise<GoldDrivers> {
  if (cache && Date.now() - cache.ts < TTL_MS && cache.data.auPrice === auPrice) {
    return cache.data;
  }
  const [xau, cnh, dxy] = await Promise.all([
    fetchXauUsd(),
    fetchUsdCnh(),
    fetchDxy().catch(() => ({ price: NaN, chgPct: NaN })),
  ]);
  const core = decomposeGold(auPrice, auPrevClose, xau.price, xau.prevClose, cnh.price, cnh.prevClose);
  const data: GoldDrivers = {
    ...core,
    dxy: Number.isFinite(dxy.price) ? dxy.price : null,
    dxyChgPct: Number.isFinite(dxy.chgPct) ? dxy.chgPct : null,
    ts: Date.now(),
    source: '新浪 hf_XAU + 东方财富 133.USDCNH/100.UDI',
  };
  cache = { ts: Date.now(), data };
  return data;
}
