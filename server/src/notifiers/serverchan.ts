import type { Notifier, Notification } from '../services/notify.js';

// Server酱通知器:一行 HTTP POST 推到微信。免费版限频 5 条/天。
// 配置:环境变量 SC_SENDKEY(在 sct.ftqq.com 注册获取)。
// 未配置 sendkey 时不应实例化(由 index.ts 判断)。
const SC_URL = 'https://sctapi.ftqq.com';

export class ServerChanNotifier implements Notifier {
  name = 'serverchan';
  constructor(private sendkey: string) {
    if (!sendkey) throw new Error('ServerChanNotifier 需要 sendkey');
  }
  async send(n: Notification): Promise<void> {
    const title = `雷达:${n.name} ${n.actionText}`;
    const desp =
      `**${n.name}** ${n.actionText}\n\n` +
      `- 综合分数:${n.score > 0 ? '+' : ''}${n.score}\n` +
      `- 当前价:${n.price}(${n.changePct >= 0 ? '+' : ''}${n.changePct}%)\n` +
      (n.intraday ? '- 注:基于盘中估值,未确认\n' : '') +
      `\n**理由**\n${n.reasons.map((r) => `- ${r}`).join('\n')}`;
    const res = await fetch(`${SC_URL}/${this.sendkey}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title, desp }).toString(),
    });
    if (!res.ok) throw new Error(`Server酱返回 ${res.status}`);
  }
}
