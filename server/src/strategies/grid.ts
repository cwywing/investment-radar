import type { Asset, Signal } from '../types.js';
import { last } from '../indicators/index.js';
import type { Strategy } from './types.js';
import { scoreToAction, toConfidence, round1 } from './types.js';

// 网格/区间:取近 60 日高低点形成区间,用当前价在区间中的百分位给出
// 低位买入、高位卖出信号。适合震荡市和贵金属这类反复来回的标的。
export const gridStrategy: Strategy = {
  meta: {
    id: 'grid',
    name: '网格区间',
    desc: '近 60 日高低点区间,低位买入 / 高位卖出',
    suitable: '震荡市、贵金属高抛低吸',
  },
  evaluate(asset: Asset): Signal {
    const c = asset.candles;
    const closes = c.map((x) => x.close);
    if (closes.length < 60) return emptySignal();

    const window = closes.slice(-60);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const price = last(closes);
    const range = high - low;
    const pos = range === 0 ? 0.5 : (price - low) / range; // 0(最低)~1(最高)

    let score = 0;
    const reasons: string[] = [];

    // 百分位越低越倾向买入,越高越倾向卖出
    // pos=0 -> +100, pos=0.5 -> 0, pos=1 -> -100
    score = Math.round((0.5 - pos) * 200);

    if (pos < 0.2) reasons.push(`当前价处于近 60 日区间 ${Math.round(pos * 100)}% 分位,接近底部`);
    else if (pos > 0.8) reasons.push(`当前价处于近 60 日区间 ${Math.round(pos * 100)}% 分位,接近顶部`);
    else if (pos < 0.4) reasons.push(`当前价处于近 60 日区间 ${Math.round(pos * 100)}% 分位,中低段`);
    else if (pos > 0.6) reasons.push(`当前价处于近 60 日区间 ${Math.round(pos * 100)}% 分位,中高段`);
    else reasons.push(`当前价处于近 60 日区间 ${Math.round(pos * 100)}% 分位,中段区域`);

    // 区间宽度(波动幅度)反映可操作空间
    const widthPct = (range / low) * 100;
    if (widthPct < 3) {
      reasons.push('近期波动极小,网格空间不足,机会有限');
    } else {
      reasons.push(`近 60 日区间宽度 ${round1(widthPct)}%,具备高抛低吸空间`);
    }

    // 距离上下轨的距离提示止盈止损位
    reasons.push(`参考买入区: ≤ ${round1(low + range * 0.2)}(下轨附近)`);
    reasons.push(`参考卖出区: ≥ ${round1(high - range * 0.2)}(上轨附近)`);

    score = clamp(score, -100, 100);

    return {
      action: scoreToAction(score),
      score: round1(score),
      confidence: toConfidence(score),
      reasons,
      dimensions: {
        // 网格策略:估值维度=区间位置(低位=估值低=看多);趋势维度用区间宽度
        // 捕捉(宽度大才有操作空间,但本身不代表方向,故中性偏低权重);
        // 风险维度:位置越接近两端(0或1)越接近反转,中段最安全。
        trend: 0,
        valuation: score,
        risk: clamp(100 - Math.abs(pos - 0.5) * 160, -100, 100),
      },
      indicators: {
        价格: price,
        区间下轨: round1(low),
        区间上轨: round1(high),
        区间宽度: round1(widthPct) + '%',
        区间位置: Math.round(pos * 100) + '%',
      },
    };
  },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function emptySignal(): Signal {
  return {
    action: 'hold',
    score: 0,
    confidence: 0,
    reasons: ['数据不足,暂无法判断'],
    indicators: {},
  };
}
