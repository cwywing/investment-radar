import type {
  AssetRadarResponse,
  AssetDetailResponse,
  StrategyListResponse,
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
