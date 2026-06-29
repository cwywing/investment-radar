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
}

export interface AssetRadarItem {
  id: string;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  price: number;
  changePct: number;
  signal: Signal;
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
