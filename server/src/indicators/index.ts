// 技术指标库 —— 全部为纯函数,输入价格序列,输出指标序列或单值。
// 输入约定:prices 按时间正序(最老 -> 最新),取最后一个元素即为"当前值"。

/** 简单移动平均线 Simple Moving Average */
export function ma(prices: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    out.push(sum / period);
  }
  return out;
}

/** 指数移动平均线 Exponential Moving Average */
export function ema(prices: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    if (i === period - 1) {
      // 以前 period 个的简单平均作为初始值
      let sum = 0;
      for (let j = 0; j < period; j++) sum += prices[j];
      prev = sum / period;
      out.push(prev);
      continue;
    }
    prev = prices[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** MACD: 返回 {dif, dea, hist } */
export function macd(prices: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(prices, fast);
  const emaSlow = ema(prices, slow);
  const dif: number[] = prices.map((_, i) =>
    isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  // DEA = EMA(DIF, signal),只对 dif 有效部分计算
  const validStart = dif.findIndex((v) => !isNaN(v));
  const dea: number[] = new Array(prices.length).fill(NaN);
  if (validStart >= 0) {
    const validDif = dif.slice(validStart);
    const validDea = ema(validDif, signal);
    for (let i = 0; i < validDea.length; i++) {
      dea[validStart + i] = validDea[i];
    }
  }
  const hist: number[] = prices.map((_, i) =>
    isNaN(dif[i]) || isNaN(dea[i]) ? NaN : (dif[i] - dea[i]) * 2,
  );
  return { dif, dea, hist };
}

/** RSI (默认 14 日) */
export function rsi(prices: number[], period = 14): number[] {
  const out: number[] = [NaN];
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      gainSum += gain;
      lossSum += loss;
      if (i === period) {
        const avgGain = gainSum / period;
        const avgLoss = lossSum / period;
        out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      } else {
        out.push(NaN);
      }
    } else {
      // Wilder 平滑
      gainSum = (gainSum * (period - 1) + gain) / period;
      lossSum = (lossSum * (period - 1) + loss) / period;
      out.push(lossSum === 0 ? 100 : 100 - 100 / (1 + gainSum / lossSum));
    }
  }
  return out;
}

/** KDJ (9, 3, 3) 需要高/低/收序列 */
export function kdj(
  highs: number[],
  lows: number[],
  closes: number[],
  n = 9,
): { k: number[]; d: number[]; j: number[] } {
  const k: number[] = [];
  const d: number[] = [];
  const j: number[] = [];
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) {
      k.push(NaN);
      d.push(NaN);
      j.push(NaN);
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let t = i - n + 1; t <= i; t++) {
      if (highs[t] > hh) hh = highs[t];
      if (lows[t] < ll) ll = lows[t];
    }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    const kv = (2 / 3) * prevK + (1 / 3) * rsv;
    const dv = (2 / 3) * prevD + (1 / 3) * kv;
    const jv = 3 * kv - 2 * dv;
    k.push(kv);
    d.push(dv);
    j.push(jv);
    prevK = kv;
    prevD = dv;
  }
  return { k, d, j };
}

/** 布林带 (默认 20 日, 2 倍标准差) */
export function bollinger(prices: number[], period = 20, mult = 2) {
  const mid: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      mid.push(NaN);
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (prices[j] - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    mid.push(mean);
    upper.push(mean + mult * sd);
    lower.push(mean - mult * sd);
  }
  return { mid, upper, lower };
}

// 取序列最后一个有效(非 NaN)值
export function last(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!Number.isNaN(arr[i])) return arr[i];
  }
  return NaN;
}

// 取倒数第 n 个有效值
export function nthLast(arr: number[], n: number): number {
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!Number.isNaN(arr[i])) {
      count++;
      if (count === n) return arr[i];
    }
  }
  return NaN;
}

/** True Range(单根 K 线的真实波幅) */
function trueRange(highs: number[], lows: number[], closes: number[], i: number): number {
  if (i === 0) return highs[0] - lows[0];
  return Math.max(
    highs[i] - lows[i],
    Math.abs(highs[i] - closes[i - 1]),
    Math.abs(lows[i] - closes[i - 1]),
  );
}

/** ATR(平均真实波幅,Wilder 平滑,默认 14 日)。输出序列,NaN 表示不足。 */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array(n).fill(NaN);
  if (n <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRange(highs, lows, closes, i);
  out[period] = sum / period;
  for (let i = period + 1; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + trueRange(highs, lows, closes, i)) / period;
  }
  return out;
}

/**
 * ADX(平均趋向指数,Wilder DMI,默认 14 日)。衡量趋势强度(不论方向)。
 * ADX>=25 视为趋势市,<=20 视为震荡市。输出序列。
 */
export function adx(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array(n).fill(NaN);
  if (n <= period * 2) return out;

  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  // 平滑 TR(=ATR)、+DM、-DM(Wilder),并算 DX
  const dx = new Array(n).fill(NaN);
  let trV = 0, pdmV = 0, mdmV = 0;
  for (let i = 1; i <= period; i++) { trV += trueRange(highs, lows, closes, i); pdmV += plusDM[i]; mdmV += minusDM[i]; }
  for (let i = period; i < n; i++) {
    if (i > period) {
      trV = (trV * (period - 1) + trueRange(highs, lows, closes, i)) / period;
      pdmV = (pdmV * (period - 1) + plusDM[i]) / period;
      mdmV = (mdmV * (period - 1) + minusDM[i]) / period;
    }
    const pdi = trV === 0 ? 0 : 100 * pdmV / trV;
    const mdi = trV === 0 ? 0 : 100 * mdmV / trV;
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : 100 * Math.abs(pdi - mdi) / denom;
  }

  // ADX = DX 的 Wilder 平滑,首个值在 index 2*period-1(前 period 个 DX 的均值)
  let dxSum = 0;
  for (let i = period; i < 2 * period && i < n; i++) dxSum += dx[i];
  let adxV = dxSum / period;
  out[Math.min(2 * period - 1, n - 1)] = adxV;
  for (let i = 2 * period; i < n; i++) {
    adxV = (adxV * (period - 1) + dx[i]) / period;
    out[i] = adxV;
  }
  return out;
}

/**
 * Supertrend(超级趋势,ATR 轨道,默认 10 日 / 3 倍)。
 * dir: 1=多头(价格在轨道上方),-1=空头。value=当前轨道线(支持位/阻力位)。
 * 经典 ATR 趋势指标,常用于黄金/期货趋势判断。
 */
export function supertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  mult = 3,
): { value: number[]; dir: number[] } {
  const n = closes.length;
  const value = new Array(n).fill(NaN);
  const dir = new Array(n).fill(NaN);
  const a = atr(highs, lows, closes, period);
  let finalUpper = NaN;
  let finalLower = NaN;
  let prevDir = 1;
  for (let i = 0; i < n; i++) {
    if (isNaN(a[i])) continue;
    const basis = (highs[i] + lows[i]) / 2;
    const upperBasic = basis + mult * a[i];
    const lowerBasic = basis - mult * a[i];
    const prevClose = i > 0 ? closes[i - 1] : closes[i];
    finalUpper = isNaN(finalUpper)
      ? upperBasic
      : upperBasic < finalUpper || prevClose > finalUpper ? upperBasic : finalUpper;
    finalLower = isNaN(finalLower)
      ? lowerBasic
      : lowerBasic > finalLower || prevClose < finalLower ? lowerBasic : finalLower;
    let d: number;
    if (prevDir === 1) d = closes[i] <= finalLower ? -1 : 1;
    else d = closes[i] >= finalUpper ? 1 : -1;
    dir[i] = d;
    value[i] = d === 1 ? finalLower : finalUpper;
    prevDir = d;
  }
  return { value, dir };
}
