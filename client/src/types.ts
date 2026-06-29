export type AssetClass = 'fund' | 'metal';

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalAction = 'buy' | 'sell' | 'hold';

export type SignalDirection = 'bullish' | 'bearish' | 'neutral';

export interface SignalCheck {
  label: string;
  direction: SignalDirection;
  detail?: string;
}

export interface DimensionScore {
  trend: number;
  valuation: number;
  risk: number;
}

export interface Signal {
  action: SignalAction;
  score: number;
  confidence: number;
  reasons: string[];
  indicators: Record<string, number | string | null>;
  checks?: SignalCheck[];
  dimensions?: DimensionScore;
}

export interface BacktestResult {
  matched: number;
  winRate: number | null;
  avgReturn: number | null;
  horizon: number;
  note: string;
  sampleInsufficient?: boolean;
}

export interface IntradaySnapshot {
  price: number;
  changePct: number;
  time: string;
  source: 'fundgz' | 'eastmoney_rt';
  isEstimate: boolean;
}

export interface AssetRadarItem {
  id: string;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  price: number;
  changePct: number;
  signal: Signal;
  loaded: 'csv' | 'real' | 'simulated';
  stale: boolean;
  intraday?: IntradaySnapshot;
  lowConfidence?: boolean; // C3:历史回测胜率<50% 且样本>=10,前端标灰警示
}

export interface AssetRadarResponse {
  strategy: string;
  count: number;
  items: AssetRadarItem[];
}

export interface AssetDetail {
  id: string;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  candles: Candle[];
  signal: Signal;
  backtest?: BacktestResult;
}

export interface AssetDetailResponse {
  strategy: string;
  asset: AssetDetail;
}

export interface StrategyMeta {
  id: string;
  name: string;
  desc: string;
  suitable: string;
}

export interface StrategyListResponse {
  strategies: StrategyMeta[];
}

export type NewsSentiment = '利好' | '利空' | '中性';
export interface NewsItem {
  title: string;
  date: string;
  url: string;
  source: string;
  sentiment: NewsSentiment;
}

// 黄金定价拆解(只展示,不进信号/回测)
export interface GoldDrivers {
  auPrice: number;
  auPrevClose: number;
  auChgPct: number;
  xauUsd: number;
  xauPrevClose: number;
  xauChgPct: number;
  usdCnh: number;
  cnyPrevClose: number;
  cnyChgPct: number;
  dxy: number | null;
  dxyChgPct: number | null;
  rmbImplied: number;
  premium: number;
  premiumStatus: '正常' | '异常偏高' | '贴水倒挂';
  intlContrib: number;
  fxContrib: number;
  premiumContrib: number;
  ts: number;
  source: string;
}

// 黄金日内/夜盘分时(只展示,不进信号/回测)
export interface GoldIntraday {
  preClose: number;
  current: number;
  vwap: number;
  distVwap: number;
  distVwapPct: number;
  sessionPhase: '夜盘' | '日盘' | '休市';
  sessionHigh: number;
  sessionLow: number;
  night: { open: number; high: number; low: number; close: number; chgPct: number; hasData: boolean };
  day: { high: number; low: number; open: number; hasData: boolean };
  barsCount: number;
  ts: number;
  source: string;
}

// 全策略概览(策略对比弹窗):对单个资产并排给出每个策略的信号 + 回测胜率。
export interface StrategyOverviewRow {
  id: string;
  name: string;
  desc: string;
  suitable: string;
  action: SignalAction;
  score: number;
  confidence: number;
  topReason: string;
  matched: number;
  winRate: number | null;
  avgReturn: number | null;
  lowConfidence: boolean;
}

export interface StrategyOverviewResponse {
  asset: { id: string; name: string; symbol: string };
  rows: StrategyOverviewRow[];
}
