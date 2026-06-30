import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFundEstimate } from '../data/providers/fundgz.js';
import { fetchGoldCandles, fetchGoldQuote } from '../data/providers/eastmoney.js';
import { fetchSinaFuturesCandles } from '../data/providers/sina.js';
import { fetchFundCandles } from '../data/providers/tiantian.js';

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

// === 新浪期货 K 线(au9999 东方财富反爬兜底) ===

test('sina AU0 JSONP 解析 -> Candle[] 升序,字段对齐', async () => {
  // 真实响应格式:/*<script>...</script>*/var_([{d,o,h,l,c,v,p,s},...])
  const body = '/*<script>location.href=\'//sina.com\';</script>*/var_([{"d":"2026-06-26","o":"878.500","h":"886.620","l":"872.860","c":"883.300","v":"123456","p":"78900","s":"0.000"},{"d":"2026-06-29","o":"888.120","h":"896.920","l":"884.000","c":"888.720","v":"234567","p":"89000","s":"0.000"}])';
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    const c = await fetchSinaFuturesCandles('AU0');
    assert.equal(c.length, 2);
    assert.deepEqual(c[0], { date: '2026-06-26', open: 878.5, high: 886.62, low: 872.86, close: 883.3, volume: 123456 });
    assert.deepEqual(c[1], { date: '2026-06-29', open: 888.12, high: 896.92, low: 884, close: 888.72, volume: 234567 });
  });
});

test('sina AU0 取最后 N 根(days 截断)', async () => {
  const arr = Array.from({ length: 10 }, (_, i) => ({ d: `2026-01-${String(i + 1).padStart(2, '0')}`, o: '100', h: '101', l: '99', c: '100.5', v: '1000' }));
  const body = `/*x*/var_(${JSON.stringify(arr)})`;
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    const c = await fetchSinaFuturesCandles('AU0', 3);
    assert.equal(c.length, 3);
    assert.equal(c[0].date, '2026-01-08');
    assert.equal(c[2].date, '2026-01-10');
  });
});

test('sina AU0 响应格式异常(无 var_ 包裹) -> 抛错', async () => {
  await withFakeFetch((() => jsonRes('sorry, page not found')) as typeof fetch, async () => {
    await assert.rejects(() => fetchSinaFuturesCandles('AU0'), /响应格式异常/);
  });
});

test('sina AU0 空数组 -> 抛错', async () => {
  await withFakeFetch((() => jsonRes('/*x*/var_([])')) as typeof fetch, async () => {
    await assert.rejects(() => fetchSinaFuturesCandles('AU0'), /无K线数据/);
  });
});

test('sina AU0 beg 增量过滤: 只返回 date >= beg', async () => {
  const arr = Array.from({ length: 10 }, (_, i) => ({ d: `2026-01-${String(i + 1).padStart(2, '0')}`, o: '100', h: '101', l: '99', c: '100.5', v: '1000' }));
  const body = `/*x*/var_(${JSON.stringify(arr)})`;
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    const c = await fetchSinaFuturesCandles('AU0', 600, '2026-01-08');
    // beg=2026-01-08 含当天(修正)+之后,共 3 根(08,09,10)
    assert.equal(c.length, 3);
    assert.equal(c[0].date, '2026-01-08');
    assert.equal(c[2].date, '2026-01-10');
  });
});

test('sina AU0 beg 增量无新数据 -> 抛错', async () => {
  const arr = [{ d: '2026-01-01', o: '100', h: '101', l: '99', c: '100.5', v: '1000' }];
  const body = `/*x*/var_(${JSON.stringify(arr)})`;
  await withFakeFetch((() => jsonRes(body)) as typeof fetch, async () => {
    await assert.rejects(() => fetchSinaFuturesCandles('AU0', 600, '2026-06-29'), /增量无新数据/);
  });
});

test('eastmoney fetchGoldCandles beg 参数拼入 URL', async () => {
  let capturedUrl = '';
  const fake = (() => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({ data: { klines: ['2026-06-29,880,885,888,878,1000'] } }),
  } as unknown as Response)) as typeof fetch;
  const wrapped = ((url: string, init?: any) => { capturedUrl = url; return (fake as any)(url, init); }) as typeof fetch;
  await withFakeFetch(wrapped, async () => {
    await fetchGoldCandles('118.au9999', 600, '2026-06-25');
    assert.ok(capturedUrl.includes('beg=20260625'), `URL 应含 beg=20260625,实际: ${capturedUrl}`);
    assert.ok(capturedUrl.includes('lmt=30'), '增量模式 lmt 应为 30');
  });
});

test('tiantian fetchFundCandles beg 参数拼入 URL + 限制页数', async () => {
  const capturedUrls: string[] = [];
  // 第 1 页返回满页,第 2 页返回空(模拟增量只有 1 页数据)
  let page = 0;
  const fake = (() => {
    page++;
    capturedUrls.push(`page${page}`);
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({
        Data: {
          LSJZList: page === 1
            ? Array.from({ length: 20 }, (_, i) => ({ FSRQ: `2026-06-${String(i + 1).padStart(2, '0')}`, DWJZ: '1.5' }))
            : [],
        },
      }),
    } as unknown as Response);
  }) as typeof fetch;
  const wrapped = ((url: string) => { capturedUrls[capturedUrls.length - 1] = url; return (fake as any)(url); }) as typeof fetch;
  await withFakeFetch(wrapped, async () => {
    const c = await fetchFundCandles('110020', '2026-06-15');
    // 增量模式:URL 应含 startDate=2026-06-15
    assert.ok(capturedUrls[0].includes('startDate=2026-06-15'), `URL 应含 startDate,实际: ${capturedUrls[0]}`);
    assert.ok(c.length > 0, '应返回净值数据');
  });
});
