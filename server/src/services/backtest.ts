import type { Asset, BacktestResult } from '../types.js';
import type { Strategy } from '../strategies/types.js';

const HORIZON = 20; // 未来 20 个交易日的表现

// 历史回测:在资产的全部历史 K 线上,对"每一天"用该策略算分,找出与
// 当前信号属同一档位(买/卖/观望)的历史时刻,统计其后 HORIZON 日的真实涨跌。
//
// 思路(ChatGPT 重点建议):不直接说"买",而说"历史上类似信号 20 日内
// 上涨概率 68%" —— 用证据建立信任。
export function backtestSignal(asset: Asset, strategy: Strategy): BacktestResult {
  const candles = asset.candles;
  // 至少要留出 HORIZON + 60(策略最小数据量)的样本,否则无意义
  // C4:数据不足不许静默返回 undefined(前端会以为"没这功能")。
  // 返回明确"样本不足"对象,前端可据此渲染提示。
  if (candles.length < 60 + HORIZON + 10) {
    return {
      matched: 0,
      winRate: NaN,
      avgReturn: NaN,
      horizon: HORIZON,
      note: '历史数据不足,无法回测',
      sampleInsufficient: true,
    };
  }

  const closes = candles.map((c) => c.close);

  // 对每个可能的"历史决策日 i",用截止到 i 的序列算分。
  // i 需满足:切片足够长(>=60),且后面还有 HORIZON 天可验证。
  const matches: number[] = []; // 每个元素是匹配日的未来收益 %
  for (let i = 59; i < candles.length - HORIZON; i++) {
    const slice: Asset = {
      ...asset,
      candles: candles.slice(0, i + 1),
    };
    const pastSignal = strategy.evaluate(slice);
    // 只统计"可操作"的历史信号(排除观望噪音),且档位与当前一致
    if (pastSignal.action === 'hold') continue;

    // 用当前最新信号档位做匹配
    const current = strategy.evaluate(asset);
    if (pastSignal.action !== current.action) continue;

    const future = closes[i + HORIZON] / closes[i] - 1;
    matches.push(future * 100);
  }

  if (matches.length < 3) {
    return {
      matched: matches.length,
      winRate: NaN,
      avgReturn: NaN,
      horizon: HORIZON,
      note: '历史相似样本不足,暂无统计意义',
    };
  }

  // 买入:未来上涨算胜;卖出:未来下跌算胜
  const current = strategy.evaluate(asset);
  const wins = matches.filter((r) =>
    current.action === 'buy' ? r > 0 : r < 0,
  ).length;
  const winRate = wins / matches.length;
  const avgReturn = matches.reduce((a, b) => a + b, 0) / matches.length;

  const winPct = Math.round(winRate * 100);
  const dir = current.action === 'buy' ? '上涨' : '下跌';
  const avgStr = (avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1) + '%';
  const note =
    winPct >= 60
      ? `历史上同类信号共 ${matches.length} 次,其后 ${HORIZON} 个交易日${dir}概率 ${winPct}%,平均收益 ${avgStr} —— 信号较可靠`
      : winPct >= 50
        ? `历史上同类信号共 ${matches.length} 次,其后 ${HORIZON} 个交易日${dir}概率 ${winPct}%,平均收益 ${avgStr} —— 信号仅供参考`
        : `历史上同类信号共 ${matches.length} 次,其后 ${HORIZON} 个交易日${dir}概率仅 ${winPct}% —— 此类信号历史上胜率不高,谨慎对待`;

  return {
    matched: matches.length,
    winRate,
    avgReturn,
    horizon: HORIZON,
    note,
  };
}
