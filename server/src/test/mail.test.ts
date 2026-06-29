import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailNotifier } from '../notifiers/mail.js';
import type { Transporter } from 'nodemailer';

// 用注入的假 transporter 测 MailNotifier,不打真实 SMTP。
test('MailNotifier 缺 user/pass -> 构造抛错', () => {
  assert.throws(() => new MailNotifier({ user: '', pass: '', to: 'a@b.com' }));
  assert.throws(() => new MailNotifier({ user: 'x@qq.com', pass: '', to: 'a@b.com' }));
});

test('MailNotifier.send 调 transporter.sendMail,内容正确', async () => {
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  const fake = { sendMail: async (m: any) => { sent.push(m); } } as unknown as Transporter;
  const n = new MailNotifier({ user: 'me@qq.com', pass: 'code', to: 'you@qq.com' }, fake);
  await n.send({
    assetId: 'a', name: '标的a', action: 'buy', actionText: '建议买入',
    score: 40, price: 1.5, changePct: 0.5, reasons: ['MA金叉', 'MACD红柱'],
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, 'me@qq.com');
  assert.equal(sent[0].to, 'you@qq.com');
  assert.ok(sent[0].subject.includes('建议买入'));
  assert.ok(sent[0].text.includes('MA金叉'));
  assert.ok(sent[0].text.includes('40'));
});

test('MailNotifier 默认收件人=user(未指定 to 时)', async () => {
  const sent: any[] = [];
  const fake = { sendMail: async (m: any) => { sent.push(m); } } as unknown as Transporter;
  const n = new MailNotifier({ user: 'me@qq.com', pass: 'code' }, fake);
  await n.send({
    assetId: 'a', name: 'x', action: 'sell', actionText: '建议卖出',
    score: -40, price: 2, changePct: -0.5, reasons: ['r'],
  });
  assert.equal(sent[0].to, 'me@qq.com');
});

test('C6 邮箱通道失败被 CompositeNotifier 兜住,不影响其他通道', async () => {
  const { scanAndNotify } = await import('../services/notify.js');
  // 坏邮箱通道:sendMail 抛错
  const badMail = new MailNotifier(
    { user: 'x@qq.com', pass: 'c', to: 'y@qq.com' },
    { sendMail: async () => { throw new Error('SMTP 拒绝'); } } as unknown as Transporter,
  );
  const good: { sent: number } = { sent: 0 };
  const goodNotifier = {
    name: 'good', send: async () => { good.sent++; },
  } as any;
  const f = `/tmp/radar-mail-c6-${process.pid}.json`;
  // 建基线
  await scanAndNotify({
    items: [{ id: 'a', name: 'x', symbol: 'X', assetClass: 'fund', price: 1, changePct: 0, signal: { action: 'hold', score: 0, confidence: 0, reasons: [], indicators: {} }, loaded: 'real', stale: false }],
    notifiers: [badMail, goodNotifier], stateFile: f,
  });
  const r = await scanAndNotify({
    items: [{ id: 'a', name: 'x', symbol: 'X', assetClass: 'fund', price: 1, changePct: 0, signal: { action: 'buy', score: 40, confidence: 0.4, reasons: ['r'], indicators: {} }, loaded: 'real', stale: false }],
    notifiers: [badMail, goodNotifier], stateFile: f,
  });
  assert.equal(r.sent, 1, '坏邮箱不影响整体发送计数');
  assert.equal(good.sent, 1, '好通道仍收到');
});
