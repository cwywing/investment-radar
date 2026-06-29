import express from 'express';
import cors from 'cors';
import { router } from './routes/assets.js';
import { warmUpAll } from './data/dataProvider.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'investment-radar' });
});

app.use('/api', router);

app.listen(PORT, () => {
  console.log(`📡 投资雷达后端已启动: http://localhost:${PORT}/api`);
  // 后台异步预热:从真实数据源加载(不阻塞启动,失败则回退模拟数据)
  console.log('⏳ 后台加载真实行情数据中(CSV > 东方财富/天天基金 > 模拟)...');
  warmUpAll();
});
