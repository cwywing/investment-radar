// Gate 4 预算执行器:把 eval/cases.md 里的 latency budget 变成可断言的 failing signal。
// 超预算不静默吞掉 —— 直接让测试红,迫使人去排查为何变慢。
import assert from 'node:assert/strict';

export function timed<T>(fn: () => T): { result: T; ms: number } {
  const t0 = Date.now();
  const result = fn();
  return { result, ms: Date.now() - t0 };
}

export async function timedAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

export function assertWithinBudget(label: string, ms: number, budgetMs: number): void {
  assert.ok(
    ms <= budgetMs,
    `${label} 超预算(failing signal): ${ms}ms > ${budgetMs}ms`,
  );
}
