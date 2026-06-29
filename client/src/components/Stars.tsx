interface Props {
  score: number; // -100 ~ +100
  max?: number;  // 满星对应分数,默认 60
}

// 把 -100~+100 的分数映射成 0~5 颗星。
// score>=max -> 5星;score<=-max -> 0星;线性插值。
export function Stars({ score, max = 60 }: Props) {
  const ratio = Math.max(0, Math.min(1, (score + max) / (max * 2)));
  const filled = Math.round(ratio * 5);
  return (
    <span className="stars">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < filled ? 'on' : 'off'}>★</span>
      ))}
    </span>
  );
}
