import type { AssetRadarItem } from '../types';
import { SignalBadge } from './SignalBadge';

interface Props {
  items: AssetRadarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const CLASS_LABEL: Record<string, string> = {
  fund: '基金',
  metal: '贵金属',
};

export function AssetList({ items, activeId, onSelect }: Props) {
  // 按信号强度排序:买入(高分在前) -> 观望 -> 卖出(低分在后)
  const sorted = [...items].sort((a, b) => b.signal.score - a.signal.score);

  return (
    <div className="signal-list">
      {sorted.map((item) => {
        const chgClass = item.changePct >= 0 ? 'up' : 'down';
        return (
          <div
            key={item.id}
            className={`signal-row ${activeId === item.id ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <SignalBadge action={item.signal.action} />
            <div style={{ minWidth: 0 }}>
              <div className="name">
                {item.name}{' '}
                <span className="sym">{item.symbol} · {CLASS_LABEL[item.assetClass]}</span>
              </div>
              <div className="reason">{item.signal.reasons[0]}</div>
            </div>
            <div className="price">
              {item.price}
              <div className={`chg ${chgClass}`}>
                {item.changePct >= 0 ? '+' : ''}{item.changePct}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
