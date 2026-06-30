import { Router } from 'express';
import { assetExists } from '../services/scan.js';
import {
  deleteHolding,
  getHolding,
  importHoldingsBatch,
  listHoldings,
  listHoldingsHistory,
  normalizeAccountKey,
  upsertHolding,
} from '../db/holdings.js';
import { buildPortfolioSummary, listAssetOptions } from '../services/portfolio.js';
import { parseHoldingsCsv } from '../services/holdingsImport.js';
import { isDatabaseReady } from '../db/database.js';

export const holdingsRouter = Router();

function dbUnavailable(res: import('express').Response): boolean {
  if (!isDatabaseReady()) {
    res.status(503).json({ error: '持仓数据库未就绪' });
    return true;
  }
  return false;
}

function parseAccountKey(raw: unknown): string {
  try {
    return normalizeAccountKey(typeof raw === 'string' ? raw : undefined);
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

// 可选标的(录入持仓时用)
holdingsRouter.get('/holdings/options', (_req, res) => {
  res.json({ options: listAssetOptions() });
});

// 变更历史
holdingsRouter.get('/holdings/history', (req, res) => {
  if (dbUnavailable(res)) return;
  const limit = Number(req.query.limit) || 50;
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : undefined;
  const accountKey = typeof req.query.accountKey === 'string' ? req.query.accountKey : undefined;
  const history = listHoldingsHistory({ limit, assetId, accountKey });
  res.json({ count: history.length, history });
});

// CSV 批量导入
holdingsRouter.post('/holdings/import', (req, res) => {
  if (dbUnavailable(res)) return;

  const csv = typeof req.body === 'string'
    ? req.body
    : typeof req.body?.csv === 'string'
      ? req.body.csv
      : '';
  if (!csv.trim()) {
    res.status(400).json({ error: '请提供 CSV 内容' });
    return;
  }

  const parsed = parseHoldingsCsv(csv);
  if (parsed.rows.length === 0) {
    res.status(400).json({ error: '没有可导入的行', details: parsed.errors });
    return;
  }

  const result = importHoldingsBatch(parsed.rows, 'csv');
  res.json({
    imported: result.imported,
    skipped: parsed.errors.length,
    errors: [...parsed.errors, ...result.errors],
    holdings: listHoldings(),
  });
});

// 持仓列表
holdingsRouter.get('/holdings', (_req, res) => {
  if (dbUnavailable(res)) return;
  const holdings = listHoldings();
  res.json({ count: holdings.length, holdings });
});

// 单条持仓(需 accountKey 查询参数,默认 default)
holdingsRouter.get('/holdings/:assetId', (req, res) => {
  if (dbUnavailable(res)) return;
  let accountKey = 'default';
  try {
    accountKey = parseAccountKey(req.query.accountKey);
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message) });
    return;
  }
  const holding = getHolding(req.params.assetId, accountKey);
  if (!holding) {
    res.status(404).json({ error: '未找到该持仓' });
    return;
  }
  res.json({ holding });
});

// 新增/更新持仓(body 含 accountKey / accountLabel)
holdingsRouter.put('/holdings/:assetId', (req, res) => {
  if (dbUnavailable(res)) return;
  const assetId = req.params.assetId;
  if (!assetExists(assetId)) {
    res.status(404).json({ error: `未找到资产: ${assetId}` });
    return;
  }

  let accountKey = 'default';
  try {
    accountKey = parseAccountKey(req.body?.accountKey);
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message) });
    return;
  }

  const shares = Number(req.body?.shares);
  if (!Number.isFinite(shares) || shares < 0) {
    res.status(400).json({ error: 'shares 必须为非负数字' });
    return;
  }

  const costPriceRaw = req.body?.costPrice;
  const costPrice = costPriceRaw === null || costPriceRaw === undefined || costPriceRaw === ''
    ? null
    : Number(costPriceRaw);
  if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
    res.status(400).json({ error: 'costPrice 必须为非负数字或留空' });
    return;
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : null;
  const accountLabel = typeof req.body?.accountLabel === 'string'
    ? req.body.accountLabel.trim().slice(0, 64)
    : null;

  const holding = upsertHolding(assetId, { shares, costPrice, note, accountKey, accountLabel }, 'manual');
  res.json({ holding });
});

// 删除持仓(需 accountKey 查询参数)
holdingsRouter.delete('/holdings/:assetId', (req, res) => {
  if (dbUnavailable(res)) return;
  let accountKey = 'default';
  try {
    accountKey = parseAccountKey(req.query.accountKey);
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message) });
    return;
  }
  const ok = deleteHolding(req.params.assetId, accountKey, 'manual');
  if (!ok) {
    res.status(404).json({ error: '未找到该持仓' });
    return;
  }
  res.json({ ok: true });
});

// 组合视图
holdingsRouter.get('/portfolio', (req, res) => {
  if (dbUnavailable(res)) return;
  const fundStrategy = typeof req.query.fundStrategy === 'string' ? req.query.fundStrategy : undefined;
  const goldStrategy = typeof req.query.goldStrategy === 'string' ? req.query.goldStrategy : undefined;
  res.json(buildPortfolioSummary({ fundStrategy, goldStrategy }));
});
