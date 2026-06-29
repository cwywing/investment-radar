import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFundEstimate } from '../data/providers/fundgz.js';
import { fetchGoldQuote } from '../data/providers/eastmoney.js';

// 用假 fetch 替换全局 fetch,测 provider 解析逻辑(不打真实网络,离线可复现)。
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

test('fundgz 解析盘中估值 -> IntradaySnapshot(isEstimate=true)', async () => {
  const body = 'jsonpgz({"fundcode":"110020","name":"x","jzrq":"2026-06-26","dwjz":"1.9688","gsz":"1.9702","gszzl":"0.07","gztime":"2026-06-29 10:50"});';
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    const snap = await fetchFundEstimate('110020');
    assert.equal(snap?.price, 1.9702);
    assert.equal(snap?.changePct, 0.07);
    assert.equal(snap?.source, 'fundgz');
    assert.equal(snap?.isEstimate, true);
    assert.equal(snap?.time, '2026-06-29 10:50');
  });
});

test('fundgz 空/非法响应 -> null(不抛错)', async () => {
  await withFakeFetch((() => jsonRes('jsonpgz();')) as typeof fetch, async () => {
    assert.equal(await fetchFundEstimate('110020'), null);
  });
});

test('eastmoney 实时报价解析 -> IntradaySnapshot(isEstimate=false)', async () => {
  const body = '{"rc":0,"data":{"f43":888.5,"f170":0.54,"f169":4.8,"f57":"AU9999","f58":"黄金9999"}}';
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    const snap = await fetchGoldQuote('118.au9999');
    assert.equal(snap?.price, 888.5);
    assert.equal(snap?.changePct, 0.54);
    assert.equal(snap?.source, 'eastmoney_rt');
    assert.equal(snap?.isEstimate, false);
    assert.ok(snap!.time.length > 0);
  });
});

test('eastmoney 实时报缺 data -> null', async () => {
  await withFakeFetch((() => jsonRes('{"rc":0,"data":null}')) as typeof fetch, async () => {
    assert.equal(await fetchGoldQuote('118.au9999'), null);
  });
});

test('eastmoney 实时报 f43=0(不支持该品种) -> null,避免前端显示 0 元', async () => {
  // ag9999/pt9995 在该接口返回 f43=0,无有效报价
  const body = '{"rc":0,"data":{"f43":0,"f170":0,"f57":"AG9999"}}';
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    assert.equal(await fetchGoldQuote('118.ag9999'), null);
  });
});

test('provider 网络失败(ok=false) -> null,不抛', async () => {
  const fake = (() => Promise.resolve({ ok: false, status: 503 } as unknown as Response)) as typeof fetch;
  await withFakeFetch(fake, async () => {
    assert.equal(await fetchFundEstimate('110020'), null);
    assert.equal(await fetchGoldQuote('118.au9999'), null);
  });
});
