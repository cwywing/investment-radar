import { Router } from 'express';
import { listStrategies, getStrategy } from '../strategies/types.js';
import { scanAll, scanOne, scanOverview, assetExists } from '../services/scan.js';
import { getSourceStatus, getAsset } from '../data/dataProvider.js';
import { getAssetNews } from '../data/news.js';
import { getGoldDrivers } from '../data/goldDrivers.js';
import { getGoldIntraday } from '../data/goldIntraday.js';

export const router = Router();

const DEFAULT_STRATEGY = 'goldFactor';
const DEFAULT_DAYS = 250;

function resolveStrategy(req: { query: { strategy?: string } }): string {
  const id = (req.query.strategy as string) || DEFAULT_STRATEGY;
  return getStrategy(id) ? id : DEFAULT_STRATEGY;
}

// 全部资产 + 信号(雷达主页用)
router.get('/assets', (req, res) => {
  const strategyId = resolveStrategy(req);
  const items = scanAll(strategyId);
  res.json({ strategy: strategyId, count: items.length, items });
});

// 单资产详情
router.get('/assets/:id', (req, res) => {
  const id = req.params.id;
  if (!assetExists(id)) {
    res.status(404).json({ error: `未找到资产: ${id}` });
    return;
  }
  const strategyId = resolveStrategy(req);
  const days = Number(req.query.days) || DEFAULT_DAYS;
  const detail = scanOne(id, strategyId, days);
  if (!detail) {
    res.status(404).json({ error: '资产数据缺失' });
    return;
  }
  res.json({ strategy: strategyId, asset: detail });
});

// 策略列表
router.get('/strategies', (_req, res) => {
  res.json({ strategies: listStrategies() });
});

// 全策略概览(策略对比弹窗用):对单个资产并排给出 5 个策略的信号 + 回测胜率。
router.get('/assets/:id/overview', (req, res) => {
  const id = req.params.id;
  if (!assetExists(id)) {
    res.status(404).json({ error: `未找到资产: ${id}` });
    return;
  }
  const ov = scanOverview(id);
  if (!ov) { res.status(404).json({ error: '资产数据缺失' }); return; }
  res.json(ov);
});

// 数据源状态:查看各资产当前是真实数据还是模拟数据
router.get('/datasources', (_req, res) => {
  res.json({ sources: getSourceStatus() });
});

// 背景动态(新闻):只展示不进分数。失败返回空数组,不抛错不影响主流程。
router.get('/news/:id', async (req, res) => {
  if (!assetExists(req.params.id)) {
    res.status(404).json({ error: `未找到资产: ${req.params.id}` });
    return;
  }
  const items = await getAssetNews(req.params.id);
  res.json({ assetId: req.params.id, count: items.length, items });
});

// 黄金定价拆解(仅 au9999):国内溢价 + 三因子贡献 + 国际快照。
// 只展示不进分数。外部源失败时返回 503 + 错误信息,前端面板降级提示。
router.get('/gold/drivers', async (_req, res) => {
  const asset = getAsset('au9999');
  if (!asset || asset.candles.length < 2) {
    res.status(503).json({ error: 'Au99.99 数据不足,无法拆解' });
    return;
  }
  const candles = asset.candles;
  const auPrice = candles[candles.length - 1].close;
  const auPrevClose = candles[candles.length - 2].close;
  try {
    const drivers = await getGoldDrivers(auPrice, auPrevClose);
    res.json({ drivers });
  } catch (e) {
    res.status(503).json({ error: `国际行情源暂不可用: ${(e as Error).message}` });
  }
});

// 黄金日内/夜盘分时(仅 au9999):VWAP 分水岭 + 夜盘区间 + 距 VWAP + 会话状态。
// 只展示不进分数。1 分钟线来自东方财富,休市时返回最近会话快照。
router.get('/gold/intraday', async (_req, res) => {
  try {
    const data = await getGoldIntraday();
    res.json({ intraday: data });
  } catch (e) {
    res.status(503).json({ error: `分时数据源暂不可用: ${(e as Error).message}` });
  }
});
