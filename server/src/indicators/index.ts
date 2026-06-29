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
