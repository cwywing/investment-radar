// K线 + 黄金多因子 SQLite 持久化(CRUD)。
// 历史日线 immutable,启动时读库,只增量抓最新(详见 dataProvider loadReal)。
// 模拟数据不入库(loaded=simulated 时调用方不调 saveCandles)。
import type { Candle } from '../types.js';
import { getDatabase, isDatabaseReady } from './database.js';

// 因子日线 = {date, close},与 goldFactors FactorDaily 同构,但 db 层不反向依赖 data 层。
export interface FactorRow {
  date: string;
  close: number;
}

interface CandleRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

/** 读某资产全部 K 线,按 date 升序。库未就绪或无数据返回 []。 */
export function loadCandles(assetId: string): Candle[] {
  if (!isDatabaseReady()) return [];
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT date, open, high, low, close, volume, source FROM candles WHERE asset_id = ? ORDER BY date ASC',
  ).all(assetId) as unknown as CandleRow[];
  return rows.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

/** 查某资产最新 K 线日期(用于增量 beg)。无数据返回 null。 */
export function getLatestDate(assetId: string): string | null {
  if (!isDatabaseReady()) return null;
  const db = getDatabase();
  const row = db.prepare(
    'SELECT MAX(date) AS d FROM candles WHERE asset_id = ?',
  ).get(assetId) as unknown as { d: string | null };
  return row.d ?? null;
}

/** 批量 upsert K 线(INSERT OR REPLACE)。历史日期重写时也走这里(修正最新一两日)。 */
export function saveCandles(assetId: string, candles: Candle[], source: string): void {
  if (!isDatabaseReady() || candles.length === 0) return;
  const db = getDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO candles (asset_id, date, open, high, low, close, volume, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // node:sqlite 无显式事务包装,手动 BEGIN/COMMIT 保证批量写入原子性
  db.exec('BEGIN');
  try {
    for (const c of candles) {
      stmt.run(assetId, c.date, c.open, c.high, c.low, c.close, c.volume, source, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 读某因子序列全部,按 date 升序。 */
export function loadFactors(series: string): FactorRow[] {
  if (!isDatabaseReady()) return [];
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT date, close FROM factors WHERE series = ? ORDER BY date ASC',
  ).all(series) as unknown as { date: string; close: number }[];
  return rows.map((r) => ({ date: r.date, close: r.close }));
}

/** 查某因子最新日期。 */
export function getLatestFactorDate(series: string): string | null {
  if (!isDatabaseReady()) return null;
  const db = getDatabase();
  const row = db.prepare(
    'SELECT MAX(date) AS d FROM factors WHERE series = ?',
  ).get(series) as unknown as { d: string | null };
  return row.d ?? null;
}

/** 批量 upsert 因子。 */
export function saveFactors(series: string, rows: FactorRow[]): void {
  if (!isDatabaseReady() || rows.length === 0) return;
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO factors (series, date, close) VALUES (?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(series, r.date, r.close);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 清空某资产 K 线(数据源切换/重置用)。 */
export function clearCandles(assetId: string): void {
  if (!isDatabaseReady()) return;
  getDatabase().prepare('DELETE FROM candles WHERE asset_id = ?').run(assetId);
}
