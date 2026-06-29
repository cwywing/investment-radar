import type { SignalAction } from '../types';

const LABEL: Record<SignalAction, string> = {
  buy: '买入',
  sell: '卖出',
  hold: '观望',
};

export function SignalBadge({ action }: { action: SignalAction }) {
  return <span className={`badge ${action}`}>{LABEL[action]}</span>;
}
