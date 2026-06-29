import { MailNotifier } from './src/notifiers/mail.js';
async function main() {
  const m = new MailNotifier({
    user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS!, to: process.env.SMTP_TO!,
  });
  await m.send({
    assetId: 'test', name: '投资雷达(测试)', action: 'buy', actionText: '建议买入',
    score: 42, price: 1.9727, changePct: 0.2,
    reasons: ['MA金叉(MA5=1.96 上穿 MA20=1.94)', 'MACD红柱放大', 'RSI偏低(RSI=42)'],
  });
  console.log('✅ 测试邮件已发送至', process.env.SMTP_TO);
}
main().catch(e => { console.error('❌ 发送失败:', e.message); process.exit(1); });
