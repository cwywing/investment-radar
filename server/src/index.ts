import express from 'express';
import cors from 'cors';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { router } from './routes/assets.js';
import { holdingsRouter } from './routes/holdings.js';
import { openDatabase } from './db/database.js';
import { warmUpAll } from './data/dataProvider.js';
import { startScheduler } from './scheduler.js';
import { configureNotifiers, configureStateFile } from './services/notify.js';
import { LogNotifier } from './notifiers/log.js';
import { ServerChanNotifier } from './notifiers/serverchan.js';
import { MailNotifier } from './notifiers/mail.js';

// 轻量 .env 加载(无新依赖):若 server/.env 存在,解析 KEY=VALUE 注入 process.env。
// 已存在的环境变量优先(不被 .env 覆盖)。
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv(): void {
  const file = join(__dirname, '../.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadEnv();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'investment-radar' });
});

app.use('/api', router);
app.use('/api', holdingsRouter);

app.listen(PORT, () => {
  console.log(`📡 投资雷达后端已启动: http://localhost:${PORT}/api`);

  // 通知通道:LogNotifier 始终启用(开发兜底);按配置叠加 Server酱 / QQ邮箱
  const notifiers = [new LogNotifier()];
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    notifiers.push(new MailNotifier({
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      to: process.env.SMTP_TO ?? process.env.SMTP_USER,
    }));
    console.log('🔔 通知通道: log + mail(QQ邮箱)');
  }
  if (process.env.SC_SENDKEY) {
    notifiers.push(new ServerChanNotifier(process.env.SC_SENDKEY));
    console.log('🔔 通知通道: log + serverchan(微信)');
  }
  if (notifiers.length === 1) {
    console.log('🔔 通知通道: log(未配置 SMTP_* 或 SC_SENDKEY,仅控制台输出)');
  }
  configureNotifiers(notifiers);
  configureStateFile(join(__dirname, '../data', 'signal-state.json'));

  try {
    openDatabase(join(__dirname, '../data', 'radar.db'));
    console.log('💾 持仓数据库已就绪: server/data/radar.db');
  } catch (e) {
    console.warn(`⚠ 持仓数据库初始化失败(持仓功能不可用): ${String((e as Error)?.message || e).slice(0, 80)}`);
  }

  // 后台异步预热:从真实数据源加载(不阻塞启动,失败则回退模拟数据)
  console.log('⏳ 后台加载真实行情数据中(CSV > 东方财富/天天基金 > 模拟)...');
  warmUpAll();
  // 交易日关键时点主动刷新 + 22:10 信号变化推送(不等 1h TTL)
  startScheduler();
});
