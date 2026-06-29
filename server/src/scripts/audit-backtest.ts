// 回测审计脚本:全资产 × 全策略跑历史回测,输出胜率报告。
// 用于回答"classic/trend/grid 策略整体靠不靠谱"——凭数据而非感觉。
//
// 关键(e5):模拟数据下的回测无意义(几何布朗运动必趋势向上,胜率虚高),
// 故模拟数据行单独标注、不计入全局结论。
//
// 用法: npm run audit   (需联网拉真实数据)
import { ASSET_CONFIGS } from '../data/assets.js';
import { refreshAsset, getAsset, getAssetSource } from '../data/dataProvider.js';
import { listStrategies, getStrategy } from '../strategies/types.js';
import { backtestSignal } from '../services/backtest.js';
import type { BacktestResult } from '../types.js';

function pct(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return '  — ';
  return `${Math.round(x * 100)}%`;
}
function ret(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return '  —  ';
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
}

async function main() {
  const strategies = listStrategies();
  console.log(`\n📊 回测审计: ${ASSET_CONFIGS.length} 资产 × ${strategies.length} 策略`);
  console.log('⏳ 加载真实数据中(需联网)...\n');

  // 并发拉真实数据(refreshAsset 内部已含重试 + 快照)
  await Promise.all(ASSET_CONFIGS.map((c) => refreshAsset(c.id)));

  interface Row {
    asset: string; strategy: string; simulated: boolean;
    bt: BacktestResult; action: string;
  }
  const rows: Row[] = [];

  for (const cfg of ASSET_CONFIGS) {
    const asset = getAsset(cfg.id);
    if (!asset) continue;
    const src = getAssetSource(cfg.id);
    const simulated = (src?.loaded ?? 'simulated') === 'simulated';
    for (const meta of strategies) {
      const strat = getStrategy(meta.id);
      if (!strat) continue;
      const sig = strat.evaluate(asset);
      const bt = backtestSignal(asset, strat);
      rows.push({ asset: cfg.id, strategy: meta.id, simulated, bt, action: sig.action });
    }
  }

  // 表头
  const head = ['资产', '策略', '数据', '动作', '样本', '胜率', '均收益', '结论'].map((s) => s.padEnd(8)).join(' ');
  console.log(head);
  console.log('-'.repeat(head.length + 20));

  for (const r of rows) {
    const flag = r.simulated ? '模拟⚠' : '真实';
    const insuff = r.bt.sampleInsufficient;
    const hasSample = r.bt.matched > 0 && Number.isFinite(r.bt.winRate);
    const reliable = !hasSample
      ? (insuff ? '样本不足' : '无样本')
      : r.bt.winRate >= 0.6 ? '可靠✓'
      : r.bt.winRate >= 0.5 ? '参考'
      : '不可靠✗';
    console.log(
      [
        r.asset.padEnd(14),
        r.strategy.padEnd(8),
        flag.padEnd(8),
        r.action.padEnd(6),
        String(r.bt.matched).padEnd(6),
        pct(r.bt.winRate).padEnd(6),
        ret(r.bt.avgReturn).padEnd(8),
        reliable,
      ].join(' '),
    );
  }

  // 全局结论:只统计真实数据 + 有样本(排除 hold/0 匹配的 NaN 行)
  console.log('\n' + '='.repeat(60));
  console.log('全局结论(仅真实数据且有样本,模拟/无样本已排除):\n');
  for (const meta of strategies) {
    const sub = rows.filter(
      (r) => r.strategy === meta.id && !r.simulated && r.bt.matched > 0 && Number.isFinite(r.bt.winRate),
    );
    if (sub.length === 0) { console.log(`  ${meta.id}: 无有效真实样本`); continue; }
    const avgWin = sub.reduce((a, r) => a + r.bt.winRate, 0) / sub.length;
    const bad = sub.filter((r) => r.bt.winRate < 0.5).length;
    console.log(
      `  ${meta.id.padEnd(8)} 有效样本=${sub.length} 平均胜率=${pct(avgWin)} 胜率<50%=${bad}/${sub.length}` +
      (bad > sub.length / 2 ? '  ⚠ 多数组合胜率不足,慎用' : ''),
    );
  }

  const simCount = rows.filter((r) => r.simulated).length;
  if (simCount > 0) {
    console.log(`\n⚠ ${simCount} 行为模拟数据(真实源拉取失败),已排除出结论,仅作占位。`);
  }
}

main().catch((e) => { console.error('审计失败:', e); process.exit(1); });
