import { Router } from 'express';
import { listStrategies, getStrategy } from '../strategies/types.js';
import { scanAll, scanOne, assetExists } from '../services/scan.js';
import { getSourceStatus } from '../data/dataProvider.js';

export const router = Router();

const DEFAULT_STRATEGY = 'classic';
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

// 数据源状态:查看各资产当前是真实数据还是模拟数据
router.get('/datasources', (_req, res) => {
  res.json({ sources: getSourceStatus() });
});
