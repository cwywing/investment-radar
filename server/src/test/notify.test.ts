import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { scanAndNotify, type Notifier, type Notification } from '../services/notify.js';
import type { AssetRadarItem, Signal } from '../types.js';

// 假通道:记录发送内容,可选抛错(测 C6)。
function mockNotifier(throw_: boolean = false): Notifier & { sent: Notification[] } {
  const sent: Notification[] = [];
  return {
    name: throw_ ? 'bad' : 'mock',
    sent,
    async send(n) {
      if (throw_) throw new Error('通道故意失败');
      sent.push(n);
    },
  } as Notifier & { sent: Notification[] };
}

function item(id: string, action: 'buy' | 'sell' | 'hold', score = 50): AssetRadarItem {
  const sig: Signal = {
    action, score, confidence: 0.5,
    reasons: [`${action}理由1`, '理由2', '理由3'],
    indicators: {},
  };
  return {
    id, name: `标的${id}`, symbol: id.toUpperCase(), assetClass: 'fund',
    price: 1.5, changePct: 0.5, signal: sig, loaded: 'real', stale: false,
  };
}

function tmpState(label: string): string {
  return join(tmpdir(), `radar-signal-state-${label}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

test('首次运行不刷屏:8 个 buy 全部只记基线,0 推送', async () => {
  const ch = mockNotifier();
  const f = tmpState('first');
  const items = Array.from({ length: 8 }, (_, i) => item(`a${i}`, 'buy'));
  const r = await scanAndNotify({ items, notifiers: [ch], stateFile: f });
  assert.equal(r.sent, 0, '首次应只记基线不推送');
  assert.equal(ch.sent.length, 0);
  rmSync(f, { force: true });
});

test('e6 hold 不推送(即使从 buy 变 hold)', async () => {
  const ch = mockNotifier();
  const f = tmpState('hold');
  await scanAndNotify({ items: [item('a', 'buy')], notifiers: [ch], stateFile: f }); // 基线 buy
  const r = await scanAndNotify({ items: [item('a', 'hold')], notifiers: [ch], stateFile: f });
  assert.equal(r.sent, 0, 'hold 不推送');
  assert.equal(ch.sent.length, 0);
  rmSync(f, { force: true });
});

test('e7 信号变化推送 1 次,同档位再扫不重复(hold→buy→buy)', async () => {
  const ch = mockNotifier();
  const f = tmpState('dedup');
  await scanAndNotify({ items: [item('a', 'hold')], notifiers: [ch], stateFile: f }); // 基线 hold
  const r1 = await scanAndNotify({ items: [item('a', 'buy')], notifiers: [ch], stateFile: f }); // 变 buy → 推
  const r2 = await scanAndNotify({ items: [item('a', 'buy')], notifiers: [ch], stateFile: f }); // 仍 buy → 不推
  assert.equal(r1.sent, 1);
  assert.equal(r2.sent, 0);
  assert.equal(ch.sent.length, 1);
  assert.equal(ch.sent[0].action, 'buy');
  rmSync(f, { force: true });
});

test('e8 状态落盘:重启(重读文件)后不重推已发信号', async () => {
  const f = tmpState('restart');
  const ch1 = mockNotifier();
  await scanAndNotify({ items: [item('a', 'hold')], notifiers: [ch1], stateFile: f }); // 基线
  await scanAndNotify({ items: [item('a', 'buy')], notifiers: [ch1], stateFile: f }); // 推 1 次,落盘

  // 模拟"重启":新通道实例 + 从同一文件加载状态,仍 buy → 不重推
  const ch2 = mockNotifier();
  const r = await scanAndNotify({ items: [item('a', 'buy')], notifiers: [ch2], stateFile: f });
  assert.equal(r.sent, 0, '重启后同档位不应重推');
  assert.equal(ch2.sent.length, 0);
  rmSync(f, { force: true });
});

test('e9 通道失败不崩:坏通道抛错,好通道仍收到,scanAndNotify 不抛', async () => {
  const bad = mockNotifier(true);
  const good = mockNotifier(false);
  const f = tmpState('fail');
  await scanAndNotify({ items: [item('a', 'hold')], notifiers: [bad, good], stateFile: f }); // 基线
  const r = await scanAndNotify({ items: [item('a', 'sell')], notifiers: [bad, good], stateFile: f });
  assert.equal(r.sent, 1, 'composite 不因单通道失败而整体失败');
  assert.equal(good.sent.length, 1, '好通道仍收到通知');
  assert.equal(good.sent[0].action, 'sell');
  rmSync(f, { force: true });
});

test('无通道时静默跳过,不抛错', async () => {
  const f = tmpState('nochannel');
  await scanAndNotify({ items: [item('a', 'hold')], notifiers: [], stateFile: f });
  const r = await scanAndNotify({ items: [item('a', 'buy')], notifiers: [], stateFile: f });
  assert.equal(r.sent, 0);
  rmSync(f, { force: true });
});
