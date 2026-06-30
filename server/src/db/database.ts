// 本地 SQLite 持久化(Node 22 内置 node:sqlite,零 npm 依赖)。
// 持仓按 (asset_id, account_key) 区分多账户;默认 account_key=default。
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS holdings (
  asset_id      TEXT NOT NULL,
  account_key   TEXT NOT NULL DEFAULT 'default',
  account_label TEXT,
  shares        REAL NOT NULL CHECK(shares >= 0),
  cost_price    REAL,
  note          TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (asset_id, account_key)
);

CREATE TABLE IF NOT EXISTS holdings_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      TEXT NOT NULL,
  account_key   TEXT NOT NULL DEFAULT 'default',
  action        TEXT NOT NULL CHECK(action IN ('upsert', 'delete', 'import')),
  shares_before REAL,
  shares_after  REAL,
  cost_price    REAL,
  note          TEXT,
  source        TEXT NOT NULL CHECK(source IN ('manual', 'csv', 'api')),
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_holdings_history_asset ON holdings_history(asset_id, account_key);
CREATE INDEX IF NOT EXISTS idx_holdings_history_created ON holdings_history(created_at DESC);
`;

// SCHEMA_V3:K线与黄金多因子持久化(增量抓取,历史 immutable 不重抓)。
// candles:每个资产每日 K 线,(asset_id,date) 唯一,source 记数据源。
// factors:黄金多因子原始日线(xau/cnh/dxy 各自序列),独立表便于东财反爬时读历史。
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS candles (
  asset_id   TEXT NOT NULL,
  date       TEXT NOT NULL,
  open       REAL NOT NULL,
  high       REAL NOT NULL,
  low        REAL NOT NULL,
  close      REAL NOT NULL,
  volume     REAL NOT NULL DEFAULT 0,
  source     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, date)
);
CREATE INDEX IF NOT EXISTS idx_candles_asset_date ON candles(asset_id, date);

CREATE TABLE IF NOT EXISTS factors (
  series TEXT NOT NULL,
  date   TEXT NOT NULL,
  close  REAL NOT NULL,
  PRIMARY KEY (series, date)
);
`;

let db: DatabaseSync | null = null;

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/** 从旧版单账户 schema 迁移;合并的 au9999 拆成招行+工行两行。 */
function migrateToMultiAccount(database: DatabaseSync): void {
  if (tableHasColumn(database, 'holdings', 'account_key')) return;

  database.exec(`
    CREATE TABLE holdings_new (
      asset_id      TEXT NOT NULL,
      account_key   TEXT NOT NULL DEFAULT 'default',
      account_label TEXT,
      shares        REAL NOT NULL CHECK(shares >= 0),
      cost_price    REAL,
      note          TEXT,
      updated_at    TEXT NOT NULL,
      PRIMARY KEY (asset_id, account_key)
    );
  `);

  const insert = database.prepare(`
    INSERT INTO holdings_new (asset_id, account_key, account_label, shares, cost_price, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const oldRows = database.prepare(
    'SELECT asset_id, shares, cost_price, note, updated_at FROM holdings',
  ).all() as {
    asset_id: string;
    shares: number;
    cost_price: number | null;
    note: string | null;
    updated_at: string;
  }[];

  for (const row of oldRows) {
    const merged = row.asset_id === 'au9999' && row.note?.includes('招行1852') && row.note?.includes('工行2327');
    if (merged) {
      insert.run('au9999', 'cmb-1852', '招行黄金(1852)', 6.6366, 1173.01, '招行黄金账户', row.updated_at);
      insert.run('au9999', 'icbc-2327', '工行积存金(2327)', 7.9285, 1024.02, '工行积存金', row.updated_at);
      continue;
    }
    insert.run(row.asset_id, 'default', null, row.shares, row.cost_price, row.note, row.updated_at);
  }

  database.exec('DROP TABLE holdings; ALTER TABLE holdings_new RENAME TO holdings;');

  if (!tableHasColumn(database, 'holdings_history', 'account_key')) {
    database.exec(`ALTER TABLE holdings_history ADD COLUMN account_key TEXT NOT NULL DEFAULT 'default'`);
  }
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL;');

  const holdingsExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='holdings'",
  ).get();

  if (holdingsExists && !tableHasColumn(database, 'holdings', 'account_key')) {
    migrateToMultiAccount(database);
  } else {
    database.exec(SCHEMA_V2);
  }

  // SCHEMA_V3:candles + factors(幂等,IF NOT EXISTS)
  database.exec(SCHEMA_V3);

  db = database;
  return database;
}

export function getDatabase(): DatabaseSync {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function isDatabaseReady(): boolean {
  return db !== null;
}

export function holdingKey(assetId: string, accountKey: string): string {
  return `${assetId}:${accountKey}`;
}
