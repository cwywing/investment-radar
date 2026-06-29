import type { Asset, Signal } from '../types.js';
import { ma, last, nthLast } from '../indicators/index.js';
import type { Strategy } from './types.js';
import { scoreToAction, toConfidence, round1 } from './types.js';

// 趋势跟踪:均线多头/空头排列 + 价格相对 MA60 + 近 N 日新高/新低突破。
// 信号较少但确定性高,适合牛市跟涨、熊市回避。
export const trendStrategy: Strategy = {
  meta: {
    id: 'trend',
    name: '趋势跟踪',
    desc: '均线多空排列 + 站上 MA60 + N日突破',
    suitable: '单边行情(牛市跟涨 / 熊市回避)',
  },
  evaluate(asset: Asset): Signal {
    const c = asset.candles;
    const closes = c.map((x) => x.close);
    if (closes.length < 60) return emptySignal();

    const ma5 = ma(closes, 5);
    const ma20 = ma(closes, 20);
    const ma60 = ma(closes, 60);
    const ma5v = last(ma5);
    const ma20v = last(ma20);
    const ma60v = last(ma60);
    const price = last(closes);
    let score = 0;
    const reasons: string[] = [];

    // 1) 多空排列
    if (!isNaN(ma5v) && !isNaN(ma20v) && !isNaN(ma60v)) {
      if (ma5v > ma20v && ma20v > ma60v) {
        score += 38;
        reasons.push('均线多头排列(MA5>MA20>MA60),中期趋势向上');
        // 排列强度
        const spread = (ma5v - ma60v) / ma60v;
        score += Math.min(15, spread * 100);
      } else if (ma5v < ma20v && ma20v < ma60v) {
        score -= 38;
        reasons.push('均线空头排列(MA5<MA20<MA60),中期趋势向下');
        const spread = (ma60v - ma5v) / ma60v;
        score -= Math.min(15, spread * 100);
      } else {
        reasons.push('均线纠缠,趋势尚未形成');
      }
    }

    // 2) 站上/跌破 MA60(中期分水岭)
    if (!isNaN(ma60v)) {
      const dev = (price - ma60v) / ma60v;
      if (price > ma60v) { score += 18; }
      else { score -= 18; }
      if (dev > 0.08) reasons.push(`价格高于 MA60 ${round1(dev * 100)}%,中期偏强`);
      else if (dev < -0.08) reasons.push(`价格低于 MA60 ${round1(-dev * 100)}%,中期偏弱`);
    }

    // 3) 近 20 日突破
    const recent = closes.slice(-21, -1); // 不含今天
    if (recent.length === 20) {
      const recentHigh = Math.max(...recent);
      const recentLow = Math.min(...recent);
      if (price > recentHigh) { score += 22; reasons.push('创近 20 日新高,动能突破'); }
      else if (price < recentLow) { score -= 22; reasons.push('跌破近 20 日新低,动能破位'); }
    }

    // 4) 短期动量:近 5 日涨幅
    const fiveAgo = nthLast(closes, 6);
    if (!isNaN(fiveAgo) && fiveAgo > 0) {
      const chg = (price - fiveAgo) / fiveAgo;
      score += clamp(chg * 120, -18, 18);
    }

    score = clamp(score, -100, 100);
    if (reasons.length === 0) reasons.push('趋势信号不明朗,建议观望');

    // 维度:趋势策略本身就是趋势驱动,趋势维度=综合分;
    // 估值维度用距 MA60 衡量;风险维度用近期动量极端度衡量。
    const dev60 = !isNaN(ma60v) ? (price - ma60v) / ma60v : 0;
    const fiveAgo2 = nthLast(closes, 6);
    const chg5 = !isNaN(fiveAgo2) && fiveAgo2 > 0 ? (price - fiveAgo2) / fiveAgo2 : 0;
    const riskScore = clamp(100 - Math.abs(chg5) * 600, -100, 100);

    return {
      action: scoreToAction(score),
      score: round1(score),
      confidence: toConfidence(score),
      reasons,
      dimensions: {
        trend: score,
        valuation: clamp(dev60 * 400, -100, 100),
        risk: riskScore,
      },
      indicators: {
        价格: price,
        MA5: round1(ma5v),
        MA20: round1(ma20v),
        MA60: round1(ma60v),
        距MA60: round1(dev60 * 100) + '%',
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
