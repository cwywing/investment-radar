import type { Notifier, Notification } from '../services/notify.js';

// 控制台通知器:始终启用的开发兜底通道。不依赖任何外部配置。
export class LogNotifier implements Notifier {
  name = 'log';
  async send(n: Notification): Promise<void> {
    const tag = n.intraday ? ' [盘中估值]' : '';
    console.log(
      `🔔 [${n.actionText}] ${n.name} 分数${n.score > 0 ? '+' : ''}${n.score} ` +
      `价${n.price}(${n.changePct >= 0 ? '+' : ''}${n.changePct}%)${tag}`,
    );
    console.log(`   理由: ${n.reasons.join(' / ')}`);
  }
}
