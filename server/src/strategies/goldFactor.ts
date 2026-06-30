import type { Asset, Signal, Candle } from '../types.js';
import { last, atr, adx } from '../indicators/index.js';
import type { Strategy } from './types.js';
import { scoreToAction, toConfidence, round1 } from './types.js';
import { volatilityFilter } from './volFilter.js';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// 黄金多因子策略 —— 把 ChatGPT/Gemini 的"黄金定价拆解"驱动因子直接写进评分。
//
//   Au99.99 ≈ XAU/USD × USD/CNH + 国内溢价
//
// 评分构成:
//   1) grid 基底(60 日区间位置,高抛低吸)—— 黄金震荡市的最稳基础(audit 62% 胜)
//   2) 国际金价动量(XAU 20 日涨跌)—— 涨→利多人民币金价
//   3) 汇率因子(USD/CNH 20 日涨跌)—— 人民币贬值→利多人民币金价
//   4) 美元指数(DXY 20 日涨跌)—— 美元走强→利空黄金(轻量确认,与汇率部分重叠)
//   5) 国内溢价 z-score(60 日)—— 溢价偏高=国内买盘强=利多
//   6) ADX 决定 grid/因子权重:趋势市(ADX≥25)因子权重大,震荡市(ADX≤20)grid 权重大
//   7) ATR 波动率过滤:极端波动不出信号,高波动降置信
//
// 因子值挂在每个 Candle 上(由 goldFactors.enrichGoldCandles 填充,前向填充,
// 回测切片时随 K 线走,无未来泄漏)。当因子缺失(早期/拉取失败)→ 回退纯 grid,
// 保证永不比 grid 差。
//
// 全部纯数学 + 客观数值序列,确定性可回测,不破坏 C3/C4。
export const goldFactorStrategy: Strategy = {
  meta: {
    id: 'goldFactor',
    name: '黄金多因子(确认)',
    desc: 'grid 定方向 + XAU/汇率/溢价/DXY/COMEX库存 做确认:同向加分,反向降权(不翻转)',
    suitable: '黄金(保住 grid 均值回归边际,用国际因子校准置信)',
  },
  evaluate(asset: Asset): Signal {
    const c = asset.candles;
    const closes = c.map((x) => x.close);
    const highs = c.map((x) => x.high);
    const lows = c.map((x) => x.low);
    if (closes.length < 60) return emptySignal();

    const price = last(closes);
    const atrV = last(atr(highs, lows, closes, 14));
    const adxV = last(adx(highs, lows, closes, 14));

    // —— grid 基底 ——
    const window = closes.slice(-60);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const range = high - low;
    const pos = range === 0 ? 0.5 : (price - low) / range;
    const gridScore = clamp(Math.round((0.5 - pos) * 200), -100, 100);

    // —— 因子评分(需要最近 K 线带因子字段) ——
    const factorResult = scoreFactors(c, 20, 60);
    const hasFactors = factorResult != null;

    // —— ADX 决定确认强度:趋势市因子更可信(确认加权),震荡市 grid 为王 ——
    const adxValid = !isNaN(adxV);
    let boostK: number;   // 同向加分系数
    let dampK: number;    // 反向降权系数(保留 grid 方向,只缩幅)
    let regime = '未知';
    if (!adxValid) { boostK = 0.25; dampK = 0.6; regime = 'ADX 不足,弱确认'; }
    else if (adxV >= 25) { boostK = 0.4; dampK = 0.7; regime = `趋势市(ADX=${round1(adxV)}),强确认`; }
    else if (adxV <= 20) { boostK = 0.15; dampK = 0.4; regime = `震荡市(ADX=${round1(adxV)}),grid 主导`; }
    else { boostK = 0.25 + ((adxV - 20) / 5) * 0.15; dampK = 0.5 + ((adxV - 20) / 5) * 0.2; regime = `中间态(ADX=${round1(adxV)})`; }

    // —— 确认式融合:方向永远由 grid 定(保住 62% 均值回归边际),因子只做确认 ——
    //   同向(因子与 grid 同号)→ 加分,信号更强;
    //   反向(因子与 grid 异号)→ 降权,弱化信号(可能退回 hold),但绝不翻转方向;
    //   grid 中性 → 因子给一点方向(轻量)。
    // 这是"动量版 16%"失败后的纠正:不让因子另起炉灶,只让它给 grid 的信号加/减置信。
    let finalScore: number;
    let align = '无因子';
    if (!hasFactors) {
      finalScore = gridScore;
      align = '因子缺失,纯 grid';
    } else {
      const fs = factorResult!.score;
      if (gridScore === 0) {
        finalScore = Math.round(0.3 * fs);
        align = 'grid 中性,因子轻量定向';
      } else if (Math.sign(fs) === Math.sign(gridScore)) {
        finalScore = Math.round(gridScore + boostK * Math.abs(fs) * Math.sign(gridScore));
        align = '因子与 grid 同向 → 加分确认';
      } else {
        finalScore = Math.round(gridScore * dampK);
        align = '因子与 grid 反向 → 降权(方向不变)';
      }
    }

    // —— ATR 波动率过滤 ——
    const vf = volatilityFilter(price, atrV);
    const reasons: string[] = [`市场状态: ${regime}`];
    reasons.push(`grid: 近 60 日区间 ${Math.round(pos * 100)}% 分位 → ${gridScore > 0 ? '偏多' : gridScore < 0 ? '偏空' : '中性'}(${align})`);
    if (hasFactors) reasons.push(...factorResult!.reasons);
    else reasons.push('因子数据缺失(早期或拉取失败),回退纯 grid 逻辑');

    if (vf.level === 'extreme') {
      reasons.push(`⚠ 极端波动(ATR/价 ${round1(vf.atrPct)}%),不出信号`);
      return {
        action: 'hold', score: 0, confidence: 0, reasons,
        dimensions: { trend: hasFactors ? factorResult!.score : 0, valuation: gridScore, risk: 0 },
        indicators: buildIndicators(price, adxV, vf, pos, factorResult),
      };
    }
    if (vf.level === 'high') reasons.push(`高波动(ATR/价 ${round1(vf.atrPct)}%),置信打折`);

    const score = clamp(finalScore, -100, 100);
    const confidence = toConfidence(score) * vf.factor;
    if (reasons.length <= 1) reasons.push('信号不明显,建议观望');

    const riskScore = clamp(100 - vf.atrPct * 12, -100, 100);
    return {
      action: scoreToAction(score),
      score: round1(score),
      confidence: round1(confidence * 100) / 100,
      reasons,
      dimensions: {
        trend: hasFactors ? factorResult!.score : gridScore,
        valuation: gridScore,
        risk: riskScore,
      },
      indicators: buildIndicators(price, adxV, vf, pos, factorResult),
    };
  },
};

interface FactorResult {
  score: number;
  reasons: string[];
  xauRet: number;
  cnhRet: number;
  dxyRet: number;
  premiumZ: number;
  comexRet: number;
  xau: number;
  cnh: number;
  dxy: number;
  premium: number;
  comex: number;
}

// 取最近一根带因子的 K 线;若近期(末尾 5 根)都没有因子 → 返回 null(回退 grid)。
function lastFactorCandle(c: Candle[]): Candle | null {
  for (let i = c.length - 1; i >= Math.max(0, c.length - 5); i--) {
    if (c[i].xau != null && c[i].cnh != null) return c[i];
  }
  return null;
}

function retOver(arr: number[], n: number): number | null {
  if (arr.length < n + 1) return null;
  const a = arr[arr.length - n - 1];
  const b = arr[arr.length - 1];
  if (!Number.isFinite(a) || a === 0) return null;
  return (b / a - 1) * 100;
}

function scoreFactors(c: Candle[], momN: number, zN: number): FactorResult | null {
  const fc = lastFactorCandle(c);
  if (!fc) return null;

  const xauSeries = c.map((x) => x.xau).filter((v): v is number => Number.isFinite(v));
  const cnhSeries = c.map((x) => x.cnh).filter((v): v is number => Number.isFinite(v));
  const dxySeries = c.map((x) => x.dxy).filter((v): v is number => Number.isFinite(v));
  const premSeries = c.map((x) => x.premium).filter((v): v is number => Number.isFinite(v));
  const comexSeries = c.map((x) => x.comex).filter((v): v is number => Number.isFinite(v));

  const xauRet = retOver(xauSeries, momN) ?? 0;
  const cnhRet = retOver(cnhSeries, momN) ?? 0;
  const dxyRet = retOver(dxySeries, momN) ?? 0;
  const comexRet = retOver(comexSeries, momN) ?? 0;

  // 溢价 z-score(近 zN 日)。溢价单位是人民币/克,正常波动在几元量级;
  // 当 std 极小(<0.5 元/克,如取整噪声或溢价长期锁死)时 z 会爆炸,必须归零。
  let premiumZ = 0;
  if (premSeries.length >= zN) {
    const slice = premSeries.slice(-zN);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    premiumZ = std >= 0.5 ? (fc.premium! - mean) / std : 0;
  }

  // 各子分映射到 [-100,100]
  // XAU 20日涨 3% → 满分看多
  const xauScore = clamp((xauRet / 3) * 100, -100, 100);
  // CNH(USD/CNY)20日涨 2%(人民币贬值)→ 满分看多人民币金价
  const cnhScore = clamp((cnhRet / 2) * 100, -100, 100);
  // DXY 20日涨 2%(美元走强)→ 满分看空黄金
  const dxyScore = clamp((-dxyRet / 2) * 100, -100, 100);
  // 溢价 z:z=+2 → 满分看多(国内需求强),z=-2 → 满分看空
  const premScore = clamp((premiumZ / 2) * 100, -100, 100);
  // COMEX 库存 20 日变化率:库存降 2% → 满分看多(实物提取需求强),
  //   库存升 2% → 满分看空(交割流入压力,短期阻碍金价)。慢变量,权重轻。
  const comexScore = clamp((-comexRet / 2) * 100, -100, 100);

  const score = clamp(
    Math.round(xauScore * 0.30 + cnhScore * 0.20 + dxyScore * 0.15 + premScore * 0.20 + comexScore * 0.15),
    -100, 100,
  );

  const reasons: string[] = [];
  reasons.push(`国际金价 XAU ${momN}日 ${xauRet >= 0 ? '+' : ''}${round1(xauRet)}% → ${xauScore > 0 ? '利多' : xauScore < 0 ? '利空' : '中性'}`);
  reasons.push(`汇率 USD/CNH ${momN}日 ${cnhRet >= 0 ? '+' : ''}${round1(cnhRet)}%(${cnhRet > 0 ? '人民币贬值,利多金价' : '人民币升值,利空金价'})`);
  if (Number.isFinite(fc.dxy)) reasons.push(`美元指数 DXY ${momN}日 ${dxyRet >= 0 ? '+' : ''}${round1(dxyRet)}% → ${dxyScore < 0 ? '利空金价' : dxyScore > 0 ? '利多金价' : '中性'}`);
  reasons.push(`国内溢价 z=${round1(premiumZ)}(${premiumZ > 0.5 ? '国内买盘偏强' : premiumZ < -0.5 ? '国内买盘偏弱' : '中性'})`);
  if (comexSeries.length > momN) {
    reasons.push(`COMEX 库存 ${momN}日 ${comexRet >= 0 ? '+' : ''}${round1(comexRet)}%(${comexRet > 0.5 ? '库存上升,利空金价' : comexRet < -0.5 ? '库存下降,利多金价' : '库存平稳,中性'})`);
  }

  return {
    score, reasons, xauRet, cnhRet, dxyRet, premiumZ, comexRet,
    xau: fc.xau!, cnh: fc.cnh!, dxy: fc.dxy ?? NaN, premium: fc.premium!,
    comex: Number.isFinite(fc.comex) ? fc.comex! : NaN,
  };
}

function buildIndicators(
  price: number, adxV: number, vf: { atrPct: number }, pos: number,
  fr: FactorResult | null,
): Signal['indicators'] {
  const ind: Signal['indicators'] = {
    价格: price,
    ADX: round1(adxV),
    ATR_pct: round1(vf.atrPct) + '%',
    区间位置: Math.round(pos * 100) + '%',
  };
  if (fr) {
    ind.XAU = round1(fr.xau);
    ind.USD_CNH = round1(fr.cnh);
    ind.DXY = round1(fr.dxy);
    ind.溢价 = round1(fr.premium);
    ind.XAU_20日 = (fr.xauRet >= 0 ? '+' : '') + round1(fr.xauRet) + '%';
    ind.CNH_20日 = (fr.cnhRet >= 0 ? '+' : '') + round1(fr.cnhRet) + '%';
    if (Number.isFinite(fr.comex)) {
      ind.COMEX库存 = round1(fr.comex) + ' 吨';
      ind.COMEX_20日 = (fr.comexRet >= 0 ? '+' : '') + round1(fr.comexRet) + '%';
    }
  }
  return ind;
}

function emptySignal(): Signal {
  return {
    action: 'hold', score: 0, confidence: 0,
    reasons: ['数据不足,暂无法判断'], indicators: {},
  };
}
