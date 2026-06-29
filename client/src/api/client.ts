import type {
  AssetRadarResponse,
  AssetDetailResponse,
  StrategyListResponse,
  StrategyOverviewResponse,
  NewsItem,
  GoldDrivers,
  GoldIntraday,
} from '../types';

const BASE = '/api';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
