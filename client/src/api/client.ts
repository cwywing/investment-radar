import type {
  AssetRadarResponse,
  AssetDetailResponse,
  StrategyListResponse,
  StrategyOverviewResponse,
  NewsItem,
  GoldDrivers,
  GoldIntraday,
  PortfolioSummary,
  AssetOption,
  HoldingRecord,
  HoldingHistoryRecord,
  HoldingsImportResult,
} from '../types';

const BASE = '/api';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function sendJSON<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function fetchAssets(strategy: string) {
  return getJSON<AssetRadarResponse>(`${BASE}/assets?strategy=${strategy}`);
}

export function fetchAssetDetail(id: string, strategy: string, days = 250) {
  return getJSON<AssetDetailResponse>(
    `${BASE}/assets/${id}?strategy=${strategy}&days=${days}`,
  );
}

export function fetchStrategies() {
  return getJSON<StrategyListResponse>(`${BASE}/strategies`);
}

export function fetchStrategiesOverview(id: string) {
  return getJSON<StrategyOverviewResponse>(`${BASE}/assets/${id}/overview`);
}

export function fetchAssetNews(id: string) {
  return getJSON<{ assetId: string; count: number; items: NewsItem[] }>(`${BASE}/news/${id}`);
}

export function fetchGoldDrivers() {
  return getJSON<{ drivers: GoldDrivers }>(`${BASE}/gold/drivers`);
}

export function fetchGoldIntraday() {
  return getJSON<{ intraday: GoldIntraday }>(`${BASE}/gold/intraday`);
}

export function fetchPortfolio(fundStrategy: string, goldStrategy: string) {
  return getJSON<PortfolioSummary>(
    `${BASE}/portfolio?fundStrategy=${fundStrategy}&goldStrategy=${goldStrategy}`,
  );
}

export function fetchAssetOptions() {
  return getJSON<{ options: AssetOption[] }>(`${BASE}/holdings/options`);
}

export function upsertHolding(
  assetId: string,
  data: {
    shares: number;
    costPrice?: number | null;
    note?: string | null;
    accountKey?: string;
    accountLabel?: string | null;
  },
) {
  return sendJSON<{ holding: HoldingRecord }>(`${BASE}/holdings/${assetId}`, 'PUT', data);
}

export function deleteHolding(assetId: string, accountKey = 'default') {
  return sendJSON<{ ok: boolean }>(
    `${BASE}/holdings/${assetId}?accountKey=${encodeURIComponent(accountKey)}`,
    'DELETE',
  );
}

export function fetchHoldingsHistory(limit = 30, assetId?: string) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (assetId) q.set('assetId', assetId);
  return getJSON<{ count: number; history: HoldingHistoryRecord[] }>(
    `${BASE}/holdings/history?${q}`,
  );
}

export function importHoldingsCsv(csv: string) {
  return sendJSON<HoldingsImportResult>(`${BASE}/holdings/import`, 'POST', { csv });
}
