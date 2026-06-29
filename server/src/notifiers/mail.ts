import nodemailer, { type Transporter } from 'nodemailer';
import type { Notifier, Notification } from '../services/notify.js';

// 邮箱通知器:默认 QQ 邮箱 SMTP(smtp.qq.com:465 SSL)。
// QQ 邮箱需在设置中开启 SMTP 服务并获取"授权码"(非登录密码),填入 SMTP_PASS。
// transporter 可注入(测试用),默认用 nodemailer.createTransport。
export interface MailNotifierOptions {
  user: string;     // 发件邮箱,如 xxx@qq.com
  pass: string;     // QQ 邮箱授权码(非登录密码)
  to?: string;      // 收件邮箱,默认同 user
  from?: string;    // 发件人,默认同 user
  host?: string;    // 默认 smtp.qq.com
  port?: number;    // 默认 465(SSL)
}

export class MailNotifier implements Notifier {
  name = 'mail';
  private transporter: Transporter;
  private from: string;
  private to: string;

  constructor(opts: MailNotifierOptions, transporter?: Transporter) {
    if (!opts.user || !opts.pass) throw new Error('MailNotifier 需要 user 与 pass(授权码)');
    this.from = opts.from ?? opts.user;
    this.to = opts.to ?? opts.user;
    this.transporter = transporter ?? nodemailer.createTransport({
      host: opts.host ?? 'smtp.qq.com',
      port: opts.port ?? 465,
      secure: (opts.port ?? 465) === 465,
      auth: { user: opts.user, pass: opts.pass },
    });
  }

  async send(n: Notification): Promise<void> {
    const subject = `雷达:${n.name} ${n.actionText}`;
    const text =
      `${n.name} ${n.actionText}\n` +
      `综合分数:${n.score > 0 ? '+' : ''}${n.score}\n` +
      `当前价:${n.price}(${n.changePct >= 0 ? '+' : ''}${n.changePct}%)\n` +
      (n.intraday ? '注:基于盘中估值,未确认\n' : '') +
      `\n理由:\n${n.reasons.map((r) => '- ' + r).join('\n')}`;
    await this.transporter.sendMail({ from: this.from, to: this.to, subject, text });
  }
}
