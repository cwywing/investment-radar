// 资产类别 —— 决定雷达上的呈现与默认策略倾向
export type AssetClass = 'fund' | 'metal';

// 单根日线 K 线(模拟数据生成 / 真实数据填充都遵守此结构)
export interface Candle {
  date: string;   // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 数据来源类型
export type DataSource = 'eastmoney_gold' | 'eastmoney_fund' | 'simulated';

// 资产静态配置
export interface AssetConfig {
  id: string;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  source: DataSource;
  secid?: string;      // 黄金/ETF 类:东方财富 secid,如 118.au9999
  fundCode?: string;   // 基金类:6位基金代码,如 110020
  // 模拟参数(真实数据回退/无网络时使用)
  seed: number;
  basePrice: number;
  drift: number;      // 年化漂移(趋势),正数看涨
  volatility: number; // 年化波动率
}

// 带运行时序列的资产
export interface Asset extends AssetConfig {
  candles: Candle[];
}

// 单个指标的当前值(供详情页展示)
export interface IndicatorSnapshot {
  [name: string]: number | string | null;
}

// 策略输出 —— 三套策略都遵守这个统一结构
// 单个量化子项的判定(用于展示"指标共振":几个看多/几个看空)
export interface SignalCheck {
  label: string;          // 如 "MA金叉"
  direction: 'bullish' | 'bearish' | 'neutral';
  detail?: string;        // 如 "MA5=2.30 上穿 MA20=2.20"
}

// 多维拆分(ChatGPT 星级思路):趋势/估值/风险,各自独立评分
export interface DimensionScore {
  trend: number;    // -100 ~ +100
  valuation: number;
  risk: number;     // 高分=风险低(安全),低分=风险高
}

// 策略输出 —— 三套策略都遵守这个统一结构
export interface Signal {
  action: 'buy' | 'sell' | 'hold';
  score: number;          // -100(强卖) ~ +100(强买)
  confidence: number;     // 0 ~ 1
  reasons: string[];      // 中文人话理由
  indicators: IndicatorSnapshot;
  checks?: SignalCheck[];      // 指标共振明细(Gemini 共振思路)
  dimensions?: DimensionScore; // 多维拆分(ChatGPT 星级思路)
}

// 雷达主页用的精简项
export interface AssetRadarItem {
  id: string;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  price: number;
  changePct: number;      // 最新一日涨跌幅 %
  signal: Signal;
}

// 详情接口返回
// 历史回测结果:与当前相似的信号在过去出现 N 次,未来 horizon 日的胜率/平均收益。
// 这是"用证据替代黑箱"的核心(ChatGPT 重点建议)。
export interface BacktestResult {
  matched: number;        // 历史相似信号出现次数
  winRate: number;        // 胜率 0~1
  avgReturn: number;      // 未来 horizon 日平均收益 %
  horizon: number;        // 回测窗口(交易日)
  note: string;           // 人话总结,如 "历史上类似信号 20 日内上涨概率 68%"
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

// 策略元信息
export interface StrategyMeta {
  id: StrategyId;
  name: string;
  desc: string;
  suitable: string;
}

export type StrategyId = 'classic' | 'trend' | 'grid';
