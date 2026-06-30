import { getDatabase } from './database.js';

export type HoldingSource = 'manual' | 'csv' | 'api';
export type HoldingHistoryAction = 'upsert' | 'delete' | 'import';

export interface HoldingRecord {
  assetId: string;
  accountKey: string;
  accountLabel: string | null;
  shares: number;
  costPrice: number | null;
  note: string | null;
  updatedAt: string;
}

export interface HoldingHistoryRecord {
  id: number;
  assetId: string;
  accountKey: string;
  action: HoldingHistoryAction;
  sharesBefore: number | null;
  sharesAfter: number | null;
  costPrice: number | null;
  note: string | null;
  source: HoldingSource;
  createdAt: string;
}

export interface UpsertHoldingInput {
  shares: number;
  costPrice?: number | null;
  note?: string | null;
  accountKey?: string;
  accountLabel?: string | null;
}

const ACCOUNT_KEY_RE = /^[a-z0-9_-]{1,32}$/;

export function normalizeAccountKey(key?: string): string {
  const k = (key ?? 'default').trim().toLowerCase();
  if (!ACCOUNT_KEY_RE.test(k)) {
    throw new Error('accountKey 仅允许小写字母/数字/下划线/连字符,1–32 位');
  }
  return k;
}

function rowToRecord(row: {
  asset_id: string;
  account_key: string;
  account_label: string | null;
  shares: number;
  cost_price: number | null;
  note: string | null;
  updated_at: string;
}): HoldingRecord {
  return {
    assetId: row.asset_id,
    accountKey: row.account_key,
    accountLabel: row.account_label,
    shares: row.shares,
    costPrice: row.cost_price,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

function rowToHistory(row: {
  id: number;
  asset_id: string;
  account_key: string;
  action: HoldingHistoryAction;
  shares_before: number | null;
  shares_after: number | null;
  cost_price: number | null;
  note: string | null;
  source: HoldingSource;
  created_at: string;
}): HoldingHistoryRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    accountKey: row.account_key,
    action: row.action,
    sharesBefore: row.shares_before,
    sharesAfter: row.shares_after,
    costPrice: row.cost_price,
    note: row.note,
    source: row.source,
    createdAt: row.created_at,
  };
}

function appendHistory(entry: {
  assetId: string;
  accountKey: string;
  action: HoldingHistoryAction;
  sharesBefore: number | null;
  sharesAfter: number | null;
  costPrice: number | null;
  note: string | null;
  source: HoldingSource;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO holdings_history
      (asset_id, account_key, action, shares_before, shares_after, cost_price, note, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.assetId,
    entry.accountKey,
    entry.action,
    entry.sharesBefore,
    entry.sharesAfter,
    entry.costPrice,
    entry.note,
    entry.source,
    new Date().toISOString(),
  );
}

export function listHoldings(): HoldingRecord[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT asset_id, account_key, account_label, shares, cost_price, note, updated_at
    FROM holdings ORDER BY updated_at DESC
  `).all() as Parameters<typeof rowToRecord>[0][];
  return rows.map(rowToRecord);
}

export function getHolding(assetId: string, accountKey = 'default'): HoldingRecord | null {
  const db = getDatabase();
  const key = normalizeAccountKey(accountKey);
  const row = db.prepare(`
    SELECT asset_id, account_key, account_label, shares, cost_price, note, updated_at
    FROM holdings WHERE asset_id = ? AND account_key = ?
  `).get(assetId, key) as Parameters<typeof rowToRecord>[0] | undefined;
  return row ? rowToRecord(row) : null;
}

export function listHoldingsHistory(opts: { limit?: number; assetId?: string; accountKey?: string } = {}): HoldingHistoryRecord[] {
  const db = getDatabase();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.assetId && opts.accountKey) {
    const rows = db.prepare(`
      SELECT id, asset_id, account_key, action, shares_before, shares_after, cost_price, note, source, created_at
      FROM holdings_history WHERE asset_id = ? AND account_key = ? ORDER BY created_at DESC LIMIT ?
    `).all(opts.assetId, normalizeAccountKey(opts.accountKey), limit) as Parameters<typeof rowToHistory>[0][];
    return rows.map(rowToHistory);
  }
  if (opts.assetId) {
    const rows = db.prepare(`
      SELECT id, asset_id, account_key, action, shares_before, shares_after, cost_price, note, source, created_at
      FROM holdings_history WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(opts.assetId, limit) as Parameters<typeof rowToHistory>[0][];
    return rows.map(rowToHistory);
  }
  const rows = db.prepare(`
    SELECT id, asset_id, account_key, action, shares_before, shares_after, cost_price, note, source, created_at
    FROM holdings_history ORDER BY created_at DESC LIMIT ?
  `).all(limit) as Parameters<typeof rowToHistory>[0][];
  return rows.map(rowToHistory);
}

export function upsertHolding(
  assetId: string,
  input: UpsertHoldingInput,
  source: HoldingSource = 'manual',
): HoldingRecord {
  const db = getDatabase();
  const accountKey = normalizeAccountKey(input.accountKey);
  const accountLabel = input.accountLabel?.trim().slice(0, 64) || null;
  const before = getHolding(assetId, accountKey);
  const updatedAt = new Date().toISOString();
  const costPrice = input.costPrice ?? null;
  const note = input.note ?? null;

  db.prepare(`
    INSERT INTO holdings (asset_id, account_key, account_label, shares, cost_price, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, account_key) DO UPDATE SET
      account_label = excluded.account_label,
      shares = excluded.shares,
      cost_price = excluded.cost_price,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(assetId, accountKey, accountLabel, input.shares, costPrice, note, updatedAt);

  appendHistory({
    assetId,
    accountKey,
    action: source === 'csv' ? 'import' : 'upsert',
    sharesBefore: before?.shares ?? null,
    sharesAfter: input.shares,
    costPrice,
    note,
    source,
  });

  return getHolding(assetId, accountKey)!;
}

export function deleteHolding(assetId: string, accountKey = 'default', source: HoldingSource = 'manual'): boolean {
  const db = getDatabase();
  const key = normalizeAccountKey(accountKey);
  const before = getHolding(assetId, key);
  if (!before) return false;

  const r = db.prepare('DELETE FROM holdings WHERE asset_id = ? AND account_key = ?').run(assetId, key);
  if (r.changes > 0) {
    appendHistory({
      assetId,
      accountKey: key,
      action: 'delete',
      sharesBefore: before.shares,
      sharesAfter: null,
      costPrice: before.costPrice,
      note: before.note,
      source,
    });
  }
  return r.changes > 0;
}

export function importHoldingsBatch(
  rows: (UpsertHoldingInput & { assetId: string })[],
  source: HoldingSource = 'csv',
): { imported: number; errors: string[] } {
  const errors: string[] = [];
  let imported = 0;
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      try {
        upsertHolding(row.assetId, row, source);
        imported++;
      } catch (e) {
        const ak = row.accountKey ?? 'default';
        errors.push(`${row.assetId}@${ak}: ${String((e as Error)?.message || e)}`);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { imported, errors };
}
