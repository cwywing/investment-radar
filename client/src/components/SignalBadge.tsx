import type { SignalAction } from '../types';

const LABEL: Record<SignalAction, string> = {
  buy: '买入',
  sell: '卖出',
  hold: '观望',
};

interface Props {
  action: SignalAction;
  score?: number; // 可选:带分数显示,如"买入 +62",列表页一目了然不用点进去
}

export function SignalBadge({ action, score }: Props) {
  const scoreStr =
    score != null && Number.isFinite(score)
      ? ` ${score >= 0 ? '+' : ''}${Math.round(score)}`
      : '';
  return (
    <span className={`badge ${action}`}>
      {LABEL[action]}
      {scoreStr}
    </span>
  );
}
