import type { StrategyMeta } from '../types';

interface Props {
  strategies: StrategyMeta[];
  active: string;
  onChange: (id: string) => void;
}

export function StrategySwitcher({ strategies, active, onChange }: Props) {
  return (
    <div className="strategy-switch">
      {strategies.map((s) => (
        <button
          key={s.id}
          className={`strategy-btn ${active === s.id ? 'active' : ''}`}
          onClick={() => onChange(s.id)}
          title={s.suitable}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
