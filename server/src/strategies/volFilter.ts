// ATR 波动率过滤(策略共用):极端波动时降置信或不出信号。
// 纯函数,便于离线测试。atrPct = ATR / 价格,即"日均真实波幅占价格的百分比"。
//
// 阈值经验值(日线):
//   < 2%  低波动,信号正常
//   2~5%  正常波动,信号正常
//   5~8%  高波动,置信打 7 折(噪声大,易假信号)
//   > 8%  极端波动(如危机/事件),不出信号(强制 hold)
export interface VolFilterResult {
  ok: boolean;          // false => 应强制 hold(极端波动)
  factor: number;       // 置信度折扣(1=正常,0.7=打折,0=禁用)
  atrPct: number;       // ATR/价格 百分比
  level: 'low' | 'normal' | 'high' | 'extreme';
}

export function volatilityFilter(price: number, atrValue: number): VolFilterResult {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(atrValue)) {
    return { ok: true, factor: 1, atrPct: NaN, level: 'normal' };
  }
  const atrPct = (atrValue / price) * 100;
  if (atrPct > 8) return { ok: false, factor: 0, atrPct, level: 'extreme' };
  if (atrPct > 5) return { ok: true, factor: 0.7, atrPct, level: 'high' };
  if (atrPct < 2) return { ok: true, factor: 1, atrPct, level: 'low' };
  return { ok: true, factor: 1, atrPct, level: 'normal' };
}
