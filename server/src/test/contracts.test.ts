import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { backtestSignal } from '../services/backtest.js';
import { scanAll, isLowConfidence } from '../services/scan.js';
import { trendStrategy } from '../strategies/trend.js';
import { ASSET_CONFIGS } from '../data/assets.js';
import type { Asset, Candle } from '../types.js';
import { timed, assertWithinBudget } from './util/budget.js';

// e4 —— C4 回测不许静默丢失:数据不足必须明示,不返回 undefined。
test('e4 回测数据不足:返回 sampleInsufficient 而非 undefined', () => {
  const short: Asset = {
    id: 't', name: 't', symbol: 'T', assetClass: 'fund',
    source: 'simulated', seed: 1, basePrice: 1, drift: 0, volatility: 0,
    candles: Array.from({ length: 30 }, (_, i): Candle => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      open: 1, high: 1, low: 1, close: 1 + i * 0.001, volume: 0,
    })),
  };
  const bt = backtestSignal(short, trendStrategy);
  assert.notEqual(bt, undefined, '不许返回 undefined');
  assert.equal(bt.sampleInsufficient, true, '必须标记 sampleInsufficient');
  assert.equal(bt.matched, 0);
  assert.ok(bt.note.length > 0, '必须有人话 note');
});

// e4 latency budget —— 回测遍历整段历史是已知重操作,200 根样本须在 1s 内(超支即 failing signal)。
test('e4 回测 latency:200 根样本 ≤ 1000ms', () => {
  const candles: Candle[] = Array.from({ length: 200 }, (_, i) => {
    const close = 100 + Math.sin(i / 9) * 3 + i * 0.05;
    return {
      date: `2025-${String((i % 28) + 1).padStart(2, '0')}-15`,
      open: close, high: close + 1, low: close - 1, close, volume: 1000,
    };
  });
  const asset: Asset = {
    id: 'bt', name: 'bt', symbol: 'BT', assetClass: 'fund',
    source: 'simulated', seed: 1, basePrice: 100, drift: 0, volatility: 0, candles,
  };
  const { ms } = timed(() => backtestSignal(asset, trendStrategy));
  assertWithinBudget('e4 回测(200 根)', ms, 1000);
});

// e10 —— C7 工具不下单:全源码不得出现交易/下单 SDK 或下单调用。
// 信号词汇 buy/sell/hold 作为字符串是合法的,故只匹配"下单/券商"语义。
test('e10 C7 不下单:源码无交易/券商调用路径', () => {
  const srcDir = join(process.cwd(), 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(p) === '.ts' && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(srcDir);
  assert.ok(files.length > 0, '应扫描到源文件');

  // 命中即说明有人接入了交易 SDK 或下单调用 —— 违反 C7。
  const ban = /place_?order|submit_?order|trade_?order|easytrader|tqsdk|quantaxis|同花顺|华泰|券商|下单接口|trade_api/i;
  const hits = files
    .filter((f) => ban.test(readFileSync(f, 'utf-8')))
    .map((f) => f.replace(srcDir + '/', ''));
  assert.deepEqual(hits, [], `发现疑似交易/下单调用,违反 C7:${hits.join(', ')}`);
});

// e2 后端契约 —— C1 数据来源可见:scanAll 产出的每个 item 必带 loaded 字段;
// 无缓存(模拟兜底)时 loaded='simulated'。前端据此标红,防 F1 假信号。
test('e2 C1 后端契约:scanAll 每个 item 带 loaded,无缓存时=simulated', () => {
  const items = scanAll('trend');
  assert.equal(items.length, ASSET_CONFIGS.length, '资产数量与配置一致');
  for (const it of items) {
    assert.ok(['csv', 'real', 'simulated'].includes(it.loaded), `${it.id} loaded 合法`);
    // 测试进程未跑 warmUpAll,缓存为空,全部应为模拟兜底
    assert.equal(it.loaded, 'simulated', `${it.id} 无缓存应为 simulated`);
    // C3:模拟数据不标 lowConfidence(回测无意义)
    assert.equal(it.lowConfidence, false, `${it.id} 模拟数据不应标低置信`);
  }
});

// e3' C3 低置信判定(纯函数):用 audit 报告里的真实失败组合验证。
test('e3 C3 isLowConfidence:真实数据 + 样本>=10 + 胜率<50% → true', () => {
  const real = 'real';
  // audit 实测的失败组合:au9999/classic sell 38%、fund-consume/grid buy 30%
  assert.equal(isLowConfidence({ matched: 44, winRate: 0.38, avgReturn: 0.7, horizon: 20, note: '' }, real), true);
  assert.equal(isLowConfidence({ matched: 291, winRate: 0.30, avgReturn: -0.8, horizon: 20, note: '' }, real), true);
  // 可靠组合:grid 金属 62%/63% → false
  assert.equal(isLowConfidence({ matched: 368, winRate: 0.62, avgReturn: 0.7, horizon: 20, note: '' }, real), false);
  // 模拟数据:即使胜率低也不标(回测无意义)
  assert.equal(isLowConfidence({ matched: 44, winRate: 0.38, avgReturn: 0.7, horizon: 20, note: '' }, 'simulated'), false);
  // 小样本噪声:matched<10 不标(避免小样本被误判不可靠)
  assert.equal(isLowConfidence({ matched: 5, winRate: 0.2, avgReturn: -1, horizon: 20, note: '' }, real), false);
  // 无样本 / 样本不足
  assert.equal(isLowConfidence({ matched: 0, winRate: 0, avgReturn: 0, horizon: 20, note: '' }, real), false);
  assert.equal(isLowConfidence({ matched: 0, winRate: NaN, avgReturn: 0, horizon: 20, note: '', sampleInsufficient: true }, real), false);
});
