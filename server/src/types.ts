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
  // 黄金多因子(仅 au9999 真实数据加载时填充,对齐到本交易日的前向填充值)。
  // 这些是 ChatGPT/Gemini 建议的"黄金定价拆解"驱动因子,现已进入 goldFactor
  // 策略评分。挂到每根 K 线上,backtestSignal 切片时随 K 线一起走,无未来泄漏。
  // 其它资产/其它策略忽略这些字段。缺失(早期或拉取失败)时为 undefined,
  // goldFactor 自动回退到纯 grid 逻辑。
  xau?: number;     // 国际现货金 XAU/USD 当日收盘(美元/盎司)
  cnh?: number;     // 美元兑离岸人民币 USD/CNH 当日收盘
  dxy?: number;     // 美元指数 DXY 当日收盘
  premium?: number; // 国内溢价(人民币/克)= close - xau*cnh/31.1035
  comex?: number;   // COMEX 黄金库存(吨)—— 慢变量,库存升=利空金价,库存降=利多
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
  // 背景动态搜索关键词(东方财富新闻搜索,多词合并去重,只展示不进分数)
  newsKeywords?: string[];
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
  loaded: 'csv' | 'real' | 'simulated'; // C1:数据来源,模拟数据前端标红
  stale: boolean;                       // C2:最新K线过期,前端警告
  intraday?: IntradaySnapshot;          // 盘中估值/实时最新价(不注入策略序列)
  lowConfidence?: boolean;              // C3:该信号历史回测胜率<50%(matched>=10),前端标灰警示 F4
  proxyNote?: string;                   // C1:近似数据源说明(如"沪金期货主力近似"),非空时前端标橙
}

// 盘中快照:基金=估值(fundgz),黄金=实时最新价(eastmoney)。
// 单独存储,不并入 candles —— 估值 ≠ 收盘净值,注入会污染 MA/回测。
export interface IntradaySnapshot {
  price: number;
  changePct: number;   // 相对昨收 %
  time: string;        // gztime 或实时时间
  source: 'fundgz' | 'eastmoney_rt';
  isEstimate: boolean; // true=盘中估值(未确认),false=实时成交价
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
  sampleInsufficient?: boolean; // 数据不足无法回测(C4:不许静默 undefined)
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

// 背景动态(新闻)条目 —— 只展示给人看,不参与信号/回测(C3/C4 不受影响)。
// sentiment 由关键词规则初判(非 LLM,确定性),仅作快速扫读辅助,标"规则初判"。
export type NewsSentiment = '利好' | '利空' | '中性';
export interface NewsItem {
  title: string;
  date: string;   // YYYY-MM-DD HH:mm:ss
  url: string;
  source: string; // 媒体名
  sentiment: NewsSentiment;
}

// 策略元信息
export interface StrategyMeta {
  id: StrategyId;
  name: string;
  desc: string;
  suitable: string;
}

export type StrategyId = 'trend' | 'regime' | 'goldFactor';
