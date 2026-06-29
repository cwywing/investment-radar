import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNews, getAssetNews, classifySentiment } from '../data/news.js';

// mock fetch:返回指定文本(模拟 JSONP 包裹)
function mockFetch(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, { status, headers: { 'content-type': 'application/javascript' } })) as any;
}

const SAMPLE = 'cb({"result":{"cmsArticleWebOld":[\
{"title":"全球最大黄金ETF持仓减少2吨","date":"2026-06-29 07:24:30","url":"http://stock.eastmoney.com/a/1.html","mediaName":"每日经济新闻"},\
{"title":"地缘扰动,<em>金价</em>延续震荡","date":"2026-06-29 11:27:54","url":"http://stock.eastmoney.com/a/2.html","mediaName":"界面新闻"}]}});';

test('news: 解析 JSONP 包裹,剥高亮标签,产出 NewsItem', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(SAMPLE) as any;
  try {
    const items = await fetchNews('黄金', 8);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, '全球最大黄金ETF持仓减少2吨');
    assert.equal(items[0].source, '每日经济新闻');
    assert.ok(items[0].url.startsWith('http'));
    // <em> 高亮标签必须被剥掉
    assert.equal(items[1].title, '地缘扰动,金价延续震荡');
    assert.equal(items[1].title.includes('<'), false);
    // sentiment 字段必须存在且合法
    assert.ok(['利好', '利空', '中性'].includes(items[0].sentiment));
  } finally {
    globalThis.fetch = orig;
  }
});

test('classifySentiment: 规则初判方向(纯函数,确定性)', () => {
  // 利好:拉升/涨停
  assert.equal(classifySentiment('黄金概念板块短线拉升，锌业股份涨停'), '利好');
  // 利空:失守/跌
  assert.equal(classifySentiment('现货黄金失守4060美元/盎司 日内跌0.55%'), '利空');
  // 利空:持仓减少
  assert.equal(classifySentiment('全球最大的黄金ETF SPDR Gold Trust持仓较前日减少2吨'), '利空');
  // 中性:无方向词
  assert.equal(classifySentiment('国际市场黄金原油价格走向何方'), '中性');
  assert.equal(classifySentiment('河南黄金集团来了'), '中性');
  // 利好:突破/走高
  assert.equal(classifySentiment('金价突破历史新高,走势走高'), '利好');
  // 利空:暴跌/重挫
  assert.equal(classifySentiment('美股存储芯片全线重挫,暴跌近24%'), '利空');
});

test('news: 空结果返回空数组', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch('cb({"result":{"cmsArticleWebOld":[]}});') as any;
  try {
    const items = await fetchNews('不存在的话题', 8);
    assert.deepEqual(items, []);
  } finally {
    globalThis.fetch = orig;
  }
});

test('news: HTTP 错误抛错(由调用方兜底)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch('error', 500) as any;
  try {
    await assert.rejects(() => fetchNews('黄金', 8), /HTTP 500/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('news: getAssetNews 无关键词资产返回空', async () => {
  // 用一个不存在 newsKeyword 的资产(构造:assetExists 用真实 id,但这里测无 cfg)
  const items = await getAssetNews('nonexistent-asset');
  assert.deepEqual(items, []);
});

test('news: getAssetNews 失败兜底为空数组,不抛错', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch('bad', 500) as any;
  try {
    // au9999 有 3 个 newsKeywords,fetch 抛错时应被吞掉返回 []
    const items = await getAssetNews('au9999');
    assert.deepEqual(items, []);
  } finally {
    globalThis.fetch = orig;
  }
});

// 多关键词合并去重:按 url 去重,按日期倒序,截 limit
test('news: getAssetNews 多关键词合并去重 + 按日期倒序', async () => {
  const orig = globalThis.fetch;
  // 按 url 中的 keyword 返回不同结果(模拟服务端按词匹配)
  globalThis.fetch = ((input: any) => {
    const u = String(input);
    const kw = u.includes('keyword%22%3A%22') ? decodeURIComponent(u.split('keyword%22%3A%22')[1].split('%22')[0]) : '';
    const A = 'cb({"result":{"cmsArticleWebOld":[{"title":"金价上涨突破新高","date":"2026-06-29 09:00:00","url":"http://x/a","mediaName":"M1"}]}});';
    const B = 'cb({"result":{"cmsArticleWebOld":[{"title":"金价上涨突破新高","date":"2026-06-29 09:00:00","url":"http://x/a","mediaName":"M1"},{"title":"现货黄金失守4000","date":"2026-06-29 10:00:00","url":"http://x/b","mediaName":"M2"}]}});';
    // 第一个关键词返回 A,后续返回 B(含与 A 同 url 的重复项 + 一条新的)
    const body = kw === '黄金' ? A : B;
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/javascript' } }));
  }) as any;
  try {
    const items = await getAssetNews('au9999'); // keywords: 黄金/金价/黄金ETF
    // 3 个关键词,但 http://x/a 去重后只剩 1 条 + http://x/b 共 2 条
    assert.equal(items.length, 2);
    // 按日期倒序:10:00 在前
    assert.equal(items[0].url, 'http://x/b');
    assert.equal(items[1].url, 'http://x/a');
    // 去重后 url 唯一
    const urls = items.map((x) => x.url);
    assert.equal(new Set(urls).size, urls.length);
  } finally {
    globalThis.fetch = orig;
  }
});
