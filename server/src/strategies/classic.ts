import type { Asset, Signal, SignalCheck, DimensionScore } from '../types.js';
import {
  ma, macd, rsi, kdj, bollinger, last, nthLast,
} from '../indicators/index.js';
import type { Strategy } from './types.js';
import { scoreToAction, toConfidence, round1, roundAdaptive } from './types.js';

// 经典综合:多个独立指标各出一票(bullish/bearish/neutral),共振汇总成评分。
// 思路(Gemini "多指标共振"):多个指标同时看多才强,任一看空就压低。
export const classicStrategy: Strategy = {
  meta: {
    id: 'classic',
    name: '经典综合',
    desc: '均线、MACD、RSI、KDJ、布林带多指标共振评分',
    suitable: '通用首选,适用多数行情',
  },
  evaluate(asset: Asset): Signal {
    const c = asset.candles;
    const closes = c.map((x) => x.close);
    const highs = c.map((x) => x.high);
    const lows = c.map((x) => x.low);
    if (closes.length < 60) return emptySignal();

    const ma5 = ma(closes, 5);
    const ma20 = ma(closes, 20);
    const ma60 = ma(closes, 60);
    const { dif, dea, hist } = macd(closes);
    const rsiArr = rsi(closes, 14);
    const { k, d, j } = kdj(highs, lows, closes);
    const { upper, lower, mid } = bollinger(closes);

    const price = last(closes);
    const checks: SignalCheck[] = [];

    // 每个指标返回一个 check + 一个权重分(-1/0/+1 乘以权重)
    const push = (label: string, dir: SignalCheck['direction'], weight: number, detail?: string) => {
      checks.push({ label, direction: dir, detail });
      return dir === 'bullish' ? weight : dir === 'bearish' ? -weight : 0;
    };

    let score = 0;
    // 维度分别累加
    let trendS = 0, trendW = 0;
    let valS = 0, valW = 0;
    let riskS = 0, riskW = 0;

    // 1) MA5/MA20 交叉与排列 —— 趋势
    const ma5v = last(ma5);
    const ma20v = last(ma20);
    const ma60v = last(ma60);
    const ma5p = nthLast(ma5, 2);
    const ma20p = nthLast(ma20, 2);
    {
      const w = 28;
      trendW += w;
      if (!isNaN(ma5p) && !isNaN(ma20p) && ma5p <= ma20p && ma5v > ma20v) {
        trendS += push('MA金叉', 'bullish', w, `MA5=${round1(ma5v)} 上穿 MA20=${round1(ma20v)}`);
      } else if (!isNaN(ma5p) && !isNaN(ma20p) && ma5p >= ma20p && ma5v < ma20v) {
        trendS += push('MA死叉', 'bearish', w, `MA5=${round1(ma5v)} 下穿 MA20=${round1(ma20v)}`);
      } else if (ma5v > ma20v) {
        trendS += push('均线多头', 'bullish', w, `MA5=${round1(ma5v)} > MA20=${round1(ma20v)}`);
      } else {
        trendS += push('均线空头', 'bearish', w, `MA5=${round1(ma5v)} < MA20=${round1(ma20v)}`);
      }
    }

    // 2) MACD —— 趋势
    const histV = last(hist);
    const histP = nthLast(hist, 2);
    const difV = last(dif);
    const deaV = last(dea);
    {
      const w = 22;
      trendW += w;
      if (!isNaN(histV) && !isNaN(histP) && histV > 0 && histV > histP) {
        trendS += push('MACD红柱放大', 'bullish', w);
      } else if (!isNaN(histV) && !isNaN(histP) && histV < 0 && histV < histP) {
        trendS += push('MACD绿柱放大', 'bearish', w);
      } else if (!isNaN(difV) && !isNaN(deaV) && difV > deaV) {
        trendS += push('MACD在零轴上方', 'bullish', w);
      } else if (!isNaN(difV) && !isNaN(deaV) && difV < deaV) {
        trendS += push('MACD在零轴下方', 'bearish', w);
      } else {
        trendS += push('MACD中性', 'neutral', w);
      }
    }

    // 3) RSI 超买超卖 —— 估值
    const rsiV = last(rsiArr);
    {
      const w = 22;
      valW += w;
      if (!isNaN(rsiV)) {
        if (rsiV < 30) valS += push('RSI超卖', 'bullish', w, `RSI=${round1(rsiV)} 历史常现反弹`);
        else if (rsiV > 70) valS += push('RSI超买', 'bearish', w, `RSI=${round1(rsiV)} 需防回调`);
        else if (rsiV < 45) valS += push('RSI偏低', 'bullish', w, `RSI=${round1(rsiV)}`);
        else if (rsiV > 55) valS += push('RSI偏高', 'bearish', w, `RSI=${round1(rsiV)}`);
        else valS += push('RSI中性', 'neutral', w, `RSI=${round1(rsiV)}`);
      }
    }

    // 4) KDJ —— 估值
    const kv = last(k);
    const jv = last(j);
    const jP = nthLast(j, 2);
    {
      const w = 16;
      valW += w;
      if (!isNaN(kv) && kv < 20) valS += push('KDJ超卖', 'bullish', w, `K=${round1(kv)}`);
      else if (!isNaN(kv) && kv > 80) valS += push('KDJ超买', 'bearish', w, `K=${round1(kv)}`);
      else if (!isNaN(jP) && jP < 0 && jv > jP) valS += push('J值拐头', 'bullish', w, '超卖区拐头向上');
      else if (!isNaN(jP) && jP > 100 && jv < jP) valS += push('J值拐头', 'bearish', w, '超买区拐头向下');
      else valS += push('KDJ中性', 'neutral', w, `K=${round1(kv)}`);
    }

    // 5) 布林带位置 —— 估值 + 风险
    const upV = last(upper);
    const loV = last(lower);
    const midV = last(mid);
    {
      const w = 14;
      valW += w;
      if (!isNaN(upV) && !isNaN(loV) && upV > loV) {
        const pos = (price - loV) / (upV - loV);
        if (pos < 0.15) valS += push('贴近下轨', 'bullish', w, '相对低位');
        else if (pos > 0.85) valS += push('贴近上轨', 'bearish', w, '相对高位');
        else valS += push('布林中段', 'neutral', w, `${Math.round(pos * 100)}%分位`);
      }
    }

    // 综合分 = 各维度归一化加权
    score = clamp(
      (trendW ? (trendS / trendW) : 0) * 55 +
      (valW ? (valS / valW) : 0) * 45,
      -100, 100,
    );

    // 风险维度:RSI 越极端 + 价格越偏离 MA60 风险越高(分数越低)
    const dev60 = !isNaN(ma60v) ? Math.abs((price - ma60v) / ma60v) : 0;
    const rsiExtreme = !isNaN(rsiV) ? Math.abs(rsiV - 50) / 50 : 0; // 0~1
    const riskScore = clamp(100 - (dev60 * 250 + rsiExtreme * 40), -100, 100);

    const dimensions: DimensionScore = {
      trend: clamp((trendW ? (trendS / trendW) : 0) * 100, -100, 100),
      valuation: clamp((valW ? (valS / valW) : 0) * 100, -100, 100),
      risk: riskScore,
    };

    // 生成人话理由:只挑非中性的检查项
    const reasons = checks
      .filter((c) => c.direction !== 'neutral')
      .map((c) => (c.detail ? `${c.label}(${c.detail})` : c.label));
    if (reasons.length === 0) reasons.push('多空力量相对均衡,暂无明显信号');

    return {
      action: scoreToAction(score),
      score: round1(score),
      confidence: toConfidence(score),
      reasons,
      checks,
      dimensions,
      indicators: {
        价格: price,
        MA5: round1(ma5v),
        MA20: round1(ma20v),
        MA60: round1(ma60v),
        MACD_DIF: roundAdaptive(difV),
        MACD_DEA: roundAdaptive(deaV),
        MACD_柱: roundAdaptive(histV),
        RSI: round1(rsiV),
        KDJ_K: round1(kv),
        KDJ_D: round1(last(d)),
        KDJ_J: round1(jv),
        布林上轨: round1(upV),
        布林中轨: round1(midV),
        布林下轨: round1(loV),
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
