import { ASSET_CONFIGS } from '../data/assets.js';
import type { UpsertHoldingInput } from '../db/holdings.js';

export interface ParsedHoldingsRow extends UpsertHoldingInput {
  assetId: string;
}

export interface ParseHoldingsCsvResult {
  rows: ParsedHoldingsRow[];
  errors: string[];
}

const ID_ALIASES = new Set(['asset_id', 'assetid', 'id']);
const SYMBOL_ALIASES = new Set(['symbol', 'code', 'fund_code', 'fundcode']);

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function resolveAssetId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const byId = ASSET_CONFIGS.find((a) => a.id === v);
  if (byId) return byId.id;
  const upper = v.toUpperCase();
  const bySymbol = ASSET_CONFIGS.find(
    (a) => a.symbol.toUpperCase() === upper || a.fundCode === v,
  );
  return bySymbol?.id ?? null;
}

function parseOptionalNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** 解析持仓 CSV。表头需含 shares + (asset_id 或 symbol)。 */
export function parseHoldingsCsv(text: string): ParseHoldingsCsvResult {
  const errors: string[] = [];
  const rows: ParsedHoldingsRow[] = [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV 至少需要表头与一行数据'] };
  }

  const headers = lines[0].split(',').map(normalizeHeader);
  const idIdx = headers.findIndex((h) => ID_ALIASES.has(h));
  const symIdx = headers.findIndex((h) => SYMBOL_ALIASES.has(h));
  const sharesIdx = headers.indexOf('shares');
  const costIdx = headers.findIndex((h) => h === 'cost_price' || h === 'costprice' || h === 'cost');
  const noteIdx = headers.indexOf('note');
  const accountKeyIdx = headers.findIndex((h) => h === 'account_key' || h === 'accountkey');
  const accountLabelIdx = headers.findIndex((h) => h === 'account_label' || h === 'accountlabel');

  if (sharesIdx < 0) {
    return { rows: [], errors: ['缺少 shares 列'] };
  }
  if (idIdx < 0 && symIdx < 0) {
    return { rows: [], errors: ['缺少 asset_id 或 symbol 列'] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const lineNo = i + 1;
    const idRaw = idIdx >= 0 ? cols[idIdx] : cols[symIdx];
    const assetId = resolveAssetId(idRaw ?? '');
    if (!assetId) {
      errors.push(`第 ${lineNo} 行:未识别标的 "${idRaw ?? ''}"`);
      continue;
    }

    const shares = Number(cols[sharesIdx]);
    if (!Number.isFinite(shares) || shares < 0) {
      errors.push(`第 ${lineNo} 行:shares 非法`);
      continue;
    }

    const costPrice = costIdx >= 0 ? parseOptionalNumber(cols[costIdx]) : null;
    if (costIdx >= 0 && cols[costIdx]?.trim() && costPrice === null) {
      errors.push(`第 ${lineNo} 行:cost_price 非法`);
      continue;
    }
    if (costPrice !== null && costPrice < 0) {
      errors.push(`第 ${lineNo} 行:cost_price 不能为负`);
      continue;
    }

    const note = noteIdx >= 0 ? (cols[noteIdx]?.trim() || null) : null;
    const accountKey = accountKeyIdx >= 0 ? (cols[accountKeyIdx]?.trim() || undefined) : undefined;
    const accountLabel = accountLabelIdx >= 0 ? (cols[accountLabelIdx]?.trim() || null) : null;
    rows.push({ assetId, shares, costPrice, note, accountKey, accountLabel });
  }

  return { rows, errors };
}
