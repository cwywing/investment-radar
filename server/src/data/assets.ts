import type { AssetClass, DataSource } from '../types.js';

// 数据来源类型说明(定义在 types.ts):
// - eastmoney_gold: 东方财富黄金/贵金属 K线接口(secid)
// - eastmoney_fund: 天天基金历史净值接口(fundCode)
// - simulated:     模拟数据(几何布朗运动,离线/无网络时回退)

export interface AssetConfig {
  id: string;
  name: string;
  symbol: string;
  assetClass: AssetClass;
  source: DataSource;
  // 真实数据源的标识:黄金=secid(如 118.au9999),基金=fundCode(如 110011)
  secid?: string;
  fundCode?: string;
  // 模拟参数(仅 source=simulated 时使用;真实数据回退时也用到)
  seed: number;
  basePrice: number;
  drift: number;
  volatility: number;
  // 背景动态搜索关键词(东方财富新闻搜索,多词合并去重,只展示不进分数)
  newsKeywords?: string[];
}

// 标的清单。真实标的已用东方财富/天天基金接口验证(2026-06-29)。
// 想加你自己的标的?在这里加一行即可:
//   黄金类: source='eastmoney_gold', secid='118.xxx'
//   基金类: source='eastmoney_fund', fundCode='xxxxxx'
export const ASSET_CONFIGS: AssetConfig[] = [
  // ===== 贵金属(东方财富 K线接口) =====
  {
    id: 'au9999',
    name: '黄金 9999 (沪金)',
    symbol: 'AU9999',
    assetClass: 'metal',
    source: 'eastmoney_gold',
    secid: '118.au9999',
    seed: 606, basePrice: 560, drift: 0.08, volatility: 0.14,
    newsKeywords: ['黄金', '金价', '黄金ETF'],
  },
  {
    id: 'ag9999',
    name: '白银 9999',
    symbol: 'AG9999',
    assetClass: 'metal',
    source: 'eastmoney_gold',
    secid: '118.ag9999',
    seed: 707, basePrice: 7.2, drift: 0.06, volatility: 0.26,
    newsKeywords: ['白银', '白银价格'],
  },
  {
    id: 'pt9995',
    name: '铂金 9995',
    symbol: 'PT9995',
    assetClass: 'metal',
    source: 'eastmoney_gold',
    secid: '118.pt9995',
    seed: 808, basePrice: 230, drift: -0.01, volatility: 0.22,
    newsKeywords: ['铂金'],
  },
  // ===== 公募基金(天天基金净值接口) =====
  {
    id: 'fund-csi300',
    name: '易方达沪深300ETF联接A',
    symbol: '110020',
    assetClass: 'fund',
    source: 'eastmoney_fund',
    fundCode: '110020',
    seed: 101, basePrice: 1.85, drift: 0.04, volatility: 0.16,
    newsKeywords: ['沪深300', '沪深300指数'],
  },
  {
    id: 'fund-tech',
    name: '华夏国证半导体芯片ETF联接A',
    symbol: '008888',
    assetClass: 'fund',
    source: 'eastmoney_fund',
    fundCode: '008888',
    seed: 202, basePrice: 1.2, drift: 0.1, volatility: 0.28,
    newsKeywords: ['半导体', '芯片', '芯片ETF'],
  },
  {
    id: 'fund-consume',
    name: '易方达消费精选股票',
    symbol: '110022',
    assetClass: 'fund',
    source: 'eastmoney_fund',
    fundCode: '110022',
    seed: 303, basePrice: 2.65, drift: 0.02, volatility: 0.2,
    newsKeywords: ['消费基金', '消费板块'],
  },
  {
    id: 'fund-bond',
    name: '易方达稳健收益债券A',
    symbol: '110007',
    assetClass: 'fund',
    source: 'eastmoney_fund',
    fundCode: '110007',
    seed: 404, basePrice: 1.08, drift: 0.03, volatility: 0.04,
    newsKeywords: ['债券基金', '债市'],
  },
  {
    id: 'fund-gold',
    name: '博时黄金ETF联接A',
    symbol: '002610',
    assetClass: 'fund',
    source: 'eastmoney_fund',
    fundCode: '002610',
    seed: 505, basePrice: 1.45, drift: 0.08, volatility: 0.14,
    newsKeywords: ['黄金ETF', '金价'],
  },
];

export function getAssetConfig(id: string): AssetConfig | undefined {
  return ASSET_CONFIGS.find((a) => a.id === id);
}
