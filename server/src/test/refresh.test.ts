import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAsset, onAssetRefresh } from '../data/dataProvider.js';

// 验证 c4:数据刷新成功后触发 onAssetRefresh 事件。
// scan 服务订阅此事件清回测缓存 —— 否则新 K 线配旧胜率(Phase1 隐患)。
function withFakeFetch(fake: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = fake;
  return fn().finally(() => { globalThis.fetch = orig; });
}

const jsonRes = (text: string) =>
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  } as unknown as Response);

// 假 fetch:K线接口返回 80 根,实时报价返回 f43=888.5。覆盖 refreshAsset 用到的两个端点。
const fakeFetch = ((url: string) => {
  const u = String(url);
  if (u.includes('kline/get')) {
    const klines = Array.from({ length: 80 }, (_, i) =>
      `2026-01-${String(i + 1).padStart(2, '0')},100,${(100 + i * 0.1).toFixed(2)},${(100 + i * 0.1).toFixed(2)},${(100 + i * 0.1).toFixed(2)},1000`,
    );
    return jsonRes(JSON.stringify({ data: { klines } }));
  }
  if (u.includes('stock/get')) {
    return jsonRes(JSON.stringify({ data: { f43: 888.5, f170: 0.5 } }));
  }
  return Promise.resolve({ ok: false, status: 404 } as unknown as Response);
}) as typeof fetch;

test('c4 数据刷新成功触发 onAssetRefresh 事件', async () => {
  const fired: string[] = [];
  const off = onAssetRefresh((id) => fired.push(id));
  await withFakeFetch(fakeFetch, async () => {
    await refreshAsset('au9999');
  });
  off();
  assert.ok(fired.includes('au9999'), '刷新成功应触发 onAssetRefresh(au9999)');
});

test('c4 数据刷新失败(404)不触发事件,只静默回退', async () => {
  const fired: string[] = [];
  const off = onAssetRefresh((id) => fired.push(id));
  const failFetch = (() => Promise.resolve({ ok: false, status: 503 } as unknown as Response)) as typeof fetch;
  await withFakeFetch(failFetch, async () => {
    await refreshAsset('pt9995');
  });
  off();
  assert.equal(fired.length, 0, '刷新失败不应触发事件(无缓存更新)');
});
