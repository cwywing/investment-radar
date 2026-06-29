import type { Asset, Signal } from '../types.js';
import { ma, ema, macd, last, atr, adx } from '../indicators/index.js';
import type { Strategy } from './types.js';
import { scoreToAction, toConfidence, round1 } from './types.js';
import { volatilityFilter } from './volFilter.js';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// 市场状态自适应(regime-adaptive):
// 用 ADX 判断当前是"趋势市"还是"震荡市",自动切到对应引擎:
//   ADX >= 25  趋势市 → 趋势引擎(EMA 排列 + MACD + 站上 MA60)
//   ADX <= 20  震荡市 → 网格引擎(60 日区间位置,高抛低吸)
//   20 < ADX < 25  中间态 → 两引擎按 ADX 权重混合
// 叠加 ATR 波动率过滤:极端波动不出信号,高波动降置信。
//
// 动机(被审计失败挣出):单一策略不通吃 —— grid 在震荡黄金上 62% 胜,
// trend 在趋势基金上 55% 胜,但反过来都<50%。让 ADX 替我们选引擎。
// 全部纯数学指标,确定性可回测,不破坏 C3/C4。
export const regimeStrategy: Strategy = {
  meta: {
    id: 'regime',
    name: '市场状态自适应',
    desc: 'ADX 判趋势/震荡,自动切趋势引擎或网格引擎 + ATR 波动过滤',
    suitable: '多资产通用(黄金震荡 / 基金趋势自动适配)',
  },
  evaluate(asset: Asset): Signal {
    const c = asset.candles;
    const closes = c.map((x) => x.close);
    const highs = c.map((x) => x.high);
    const lows = c.map((x) => x.low);
    if (closes.length < 60) return emptySignal();

    const price = last(closes);
    const ma60v = last(ma(closes, 60));
    const ema20 = last(ema(closes, 20));
    const ema50 = last(ema(closes, 50));
    const { dif, hist } = macd(closes);
    const difV = last(dif);
    const histV = last(hist);
    const adxV = last(adx(highs, lows, closes, 14));
    const atrV = last(atr(highs, lows, closes, 14));

    // —— 趋势引擎得分 ——
    let trendScore = 0;
    const trendReasons: string[] = [];
    if (!isNaN(ema20) && !isNaN(ema50) && !isNaN(ma60v)) {
      if (ema20 > ema50 && price > ma60v) {
        trendScore += 45;
        trendReasons.push('趋势引擎:EMA20>EMA50 且站上 MA60,多头趋势');
      } else if (ema20 < ema50 && price < ma60v) {
        trendScore -= 45;
        trendReasons.push('趋势引擎:EMA20<EMA50 且破 MA60,空头趋势');
      }
    }
    if (!isNaN(difV)) {
      if (difV > 0) { trendScore += 20; trendReasons.push('MACD:DIF 在零轴上方'); }
      else { trendScore -= 20; trendReasons.push('MACD:DIF 在零轴下方'); }
    }
    if (!isNaN(histV)) {
      if (histV > 0) trendScore += 10;
      else trendScore -= 10;
    }
    trendScore = clamp(trendScore, -100, 100);

    // —— 网格引擎得分(60 日区间位置) ——
    let gridScore = 0;
    const gridReasons: string[] = [];
    const window = closes.slice(-60);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const range = high - low;
    const pos = range === 0 ? 0.5 : (price - low) / range;
    gridScore = Math.round((0.5 - pos) * 200);
    gridScore = clamp(gridScore, -100, 100);
    gridReasons.push(`网格引擎:近 60 日区间 ${Math.round(pos * 100)}% 分位`);

    // —— 按 ADX 权重融合 ——
    const adxValid = !isNaN(adxV);
    let wTrend: number;
    let regime = '未知';
    if (!adxValid) {
      wTrend = 0.5; regime = 'ADX 不足,各半';
    } else if (adxV >= 25) {
      wTrend = 1; regime = `趋势市(ADX=${round1(adxV)})`;
    } else if (adxV <= 20) {
      wTrend = 0; regime = `震荡市(ADX=${round1(adxV)})`;
    } else {
      // 20~25 之间线性过渡
      wTrend = (adxV - 20) / 5;
      regime = `中间态(ADX=${round1(adxV)},趋势权重 ${Math.round(wTrend * 100)}%)`;
    }
    const wGrid = 1 - wTrend;
    let score = Math.round(trendScore * wTrend + gridScore * wGrid);

    // —— ATR 波动率过滤 ——
    const vf = volatilityFilter(price, atrV);
    let reasons: string[] = [`市场状态: ${regime}`];
    reasons.push(...(wTrend >= 0.5 ? trendReasons : gridReasons));
    if (vf.level === 'extreme') {
      reasons.push(`⚠ 极端波动(ATR/价 ${round1(vf.atrPct)}%),不出信号`);
      return {
        action: 'hold',
        score: 0,
        confidence: 0,
        reasons,
        dimensions: { trend: trendScore, valuation: gridScore, risk: 0 },
        indicators: {
          价格: price, ADX: round1(adxV), ATR_pct: round1(vf.atrPct) + '%',
          区间位置: Math.round(pos * 100) + '%', EMA20: round1(ema20), EMA50: round1(ema50),
        },
      };
    }
    if (vf.level === 'high') {
      reasons.push(`高波动(ATR/价 ${round1(vf.atrPct)}%),置信打折`);
    }

    score = clamp(score, -100, 100);
    const confidence = toConfidence(score) * vf.factor;
    if (reasons.length <= 1) reasons.push('信号不明显,建议观望');

    // 维度:趋势维度=趋势引擎分;估值维度=网格引擎分(区间位置);风险维度=波动率
    const riskScore = clamp(100 - vf.atrPct * 12, -100, 100);

    return {
      action: scoreToAction(score),
      score: round1(score),
      confidence: round1(confidence * 100) / 100,
      reasons,
      dimensions: {
        trend: trendScore,
        valuation: gridScore,
        risk: riskScore,
      },
      indicators: {
        价格: price,
        ADX: round1(adxV),
        ATR_pct: round1(vf.atrPct) + '%',
        区间位置: Math.round(pos * 100) + '%',
        EMA20: round1(ema20),
        EMA50: round1(ema50),
        MA60: round1(ma60v),
        MACD_DIF: round1(difV),
      },
    };
  },
};

function emptySignal(): Signal {
  return {
    action: 'hold',
    score: 0,
    confidence: 0,
    reasons: ['数据不足,暂无法判断'],
    indicators: {},
  };
}
