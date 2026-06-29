import { useEffect, useRef, useState } from 'react';
import type { AssetRadarItem } from '../types';
import type { ThemeColors } from '../theme';

interface Props {
  items: AssetRadarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  colors: ThemeColors;
}

const SIZE = 520;
const CENTER = SIZE / 2;
const RINGS = 4;

const ACTION_COLOR: Record<string, string> = {
  buy: '#22c55e',
  sell: '#ef4444',
  hold: '#eab308',
};

// 资产 -> 雷达坐标:角度按资产在列表中的位置均分,半径按波动率映射。
function position(item: AssetRadarItem, index: number, total: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2; // 从顶部开始
  // 波动率越大,光点越靠外(风险/活跃度可视)。这里用涨跌幅绝对值 + 信号强度做微调。
  const intensity = Math.min(1, (Math.abs(item.signal.score) / 60) * 0.6 + 0.4);
  const radius = (CENTER - 50) * intensity;
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

export function Radar({ items, activeId, onSelect, colors }: Props) {
  const [sweepAngle, setSweepAngle] = useState(0);
  const rafRef = useRef<number | null>(null);

  // 旋转扫描线 (CSS 动画也可,这里用 RAF 以便和光点高亮联动)
  useEffect(() => {
    let start: number | null = null;
    const duration = 4000; // 4 秒一圈
    const tick = (t: number) => {
      if (start === null) start = t;
      const elapsed = (t - start) % duration;
      setSweepAngle((elapsed / duration) * 360);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // 判断某个光点是否正被扫描线"扫到"(角度接近时高亮)
  function isLit(index: number): boolean {
    const total = items.length || 1;
    const itemAngle = ((index / total) * 360) % 360;
    // 扫描线在光点后方 0~35 度内视为被照亮
    const behind = (itemAngle - sweepAngle + 360) % 360;
    return behind < 35;
  }

  return (
    <svg className="radar-svg" viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <defs>
        {/* 扫描扇形渐变 */}
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={colors.accent} stopOpacity="0" />
          <stop offset="100%" stopColor={colors.accent} stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={colors.bgPanel} stopOpacity="1" />
          <stop offset="100%" stopColor={colors.bg} stopOpacity="1" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 底盘 */}
      <circle cx={CENTER} cy={CENTER} r={CENTER - 8} fill="url(#bgGrad)" />

      {/* 同心圆刻度 */}
      {Array.from({ length: RINGS }).map((_, i) => (
        <circle
          key={i}
          cx={CENTER}
          cy={CENTER}
          r={((CENTER - 40) / RINGS) * (i + 1)}
          fill="none"
          stroke={colors.border}
          strokeWidth="1"
          opacity={0.7}
        />
      ))}

      {/* 十字基准线 */}
      <line x1={CENTER} y1={12} x2={CENTER} y2={SIZE - 12} stroke={colors.border} strokeWidth="1" opacity={0.5} />
      <line x1={12} y1={CENTER} x2={SIZE - 12} y2={CENTER} stroke={colors.border} strokeWidth="1" opacity={0.5} />

      {/* 扫描扇形 */}
      <g transform={`rotate(${sweepAngle} ${CENTER} ${CENTER})`}>
        <path
          d={`M ${CENTER} ${CENTER} L ${CENTER} 12 A ${CENTER - 12} ${CENTER - 12} 0 0 1 ${
            CENTER + Math.sin((40 * Math.PI) / 180) * (CENTER - 12)
          } ${CENTER - Math.cos((40 * Math.PI) / 180) * (CENTER - 12)} Z`}
          fill="url(#sweep)"
        />
        <line x1={CENTER} y1={CENTER} x2={CENTER} y2={12} stroke={colors.accent} strokeWidth="1.5" opacity="0.8" />
      </g>

      {/* 资产光点 */}
      {items.map((item, i) => {
        const { x, y } = position(item, i, items.length);
        const color = ACTION_COLOR[item.signal.action] || '#eab308';
        const lit = isLit(i);
        const isActive = activeId === item.id;
        const r = 5 + (Math.abs(item.signal.score) / 100) * 7;
        return (
          <g
            key={item.id}
            onClick={() => onSelect(item.id)}
            style={{ cursor: 'pointer' }}
          >
            {/* 外发光环 */}
            <circle
              cx={x}
              cy={y}
              r={r + 6}
              fill={color}
              opacity={lit || isActive ? 0.25 : 0.08}
            />
            {/* 主光点 */}
            <circle
              cx={x}
              cy={y}
              r={isActive ? r + 2 : r}
              fill={color}
              opacity={lit ? 1 : 0.55}
              filter="url(#glow)"
            />
            {/* 标签:被照亮或被选中时显示 */}
            {(lit || isActive) && (
              <text
                x={x}
                y={y - r - 8}
                fill={colors.text}
                fontSize="11"
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {item.symbol}
              </text>
            )}
          </g>
        );
      })}

      {/* 中心点 */}
      <circle cx={CENTER} cy={CENTER} r="3" fill={colors.accent} />
    </svg>
  );
}
