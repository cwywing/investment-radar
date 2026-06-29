// 背景动态(新闻)——只展示给人看,不进信号分数,不进回测。
// 数据源:东方财富搜索 JSONP 接口(关键词由服务端匹配,我们只取结果)。
//   "多一些"用多关键词合并去重实现(财联社/新浪第二源实测不稳:404 或非主题)。
// 方向标注:关键词规则初判(非 LLM,确定性),仅快速扫读辅助,标"规则初判"。
//   模糊标题标中性;要更准需引 LLM(需 API key),留作后续升级。
import { getAssetConfig } from './assets.js';
import type { NewsItem, NewsSentiment } from '../types.js';

const SEARCH_URL = 'https://search-api-web.eastmoney.com/search/jsonp';
const TTL_MS = 10 * 60 * 1000; // 新闻 10 分钟缓存

interface CacheEntry { ts: number; items: NewsItem[]; }
const cache = new Map<string, CacheEntry>(); // 按 keyword 缓存原始结果

// —— 利好/利空关键词规则(中文金融标题常见方向词) ——
const BULL_WORDS = [
  '利好', '上涨', '涨停', '大涨', '拉升', '突破', '增持', '回购', '扩产',
  '供不应求', '反弹', '走高', '高开', '连涨', '创新高', '放量', '走强',
  '回暖', '爆发', '强势', '加仓',
];
const BEAR_WORDS = [
  '利空', '下跌', '暴跌', '大跌', '失守', '重挫', '减持', '出逃', '跌破',
  '走低', '连跌', '创新低', '重创', '下挫', '下行', '转跌', '下探', '砍仓',
  '减仓', '持仓减少', '承压', '走弱', '重挫', '下降', '减少', '下滑',
];

// 纯函数:按标题关键词初判方向。bull/bear 命中数对比,平手→中性。
export function classifySentiment(title: string): NewsSentiment {
  let bull = 0;
  let bear = 0;
  for (const w of BULL_WORDS) if (title.includes(w)) bull++;
  for (const w of BEAR_WORDS) if (title.includes(w)) bear++;
  if (bull > bear) return '利好';
  if (bear > bull) return '利空';
  return '中性';
}

// 剥 JSONP 包裹 cb(...) → JSON
function unwrapJsonp(text: string): any {
  const m = text.match(/^cb\((.*)\);?\s*$/s);
  return JSON.parse(m ? m[1] : text);
}

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

// 拉一个关键词的最新新闻。失败抛错(由调用方兜底)。
export async function fetchNews(keyword: string, limit = 6): Promise<NewsItem[]> {
  const param = JSON.stringify({
    uid: '',
    keyword,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize: limit,
        preTag: '',
        postTag: '',
      },
    },
  });
  const url = `${SEARCH_URL}?cb=cb&param=${encodeURIComponent(param)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`news search HTTP ${res.status}`);
  const json = unwrapJsonp(await res.text());
  const arr: any[] = json?.result?.cmsArticleWebOld ?? [];
  return arr.map((x) => ({
    title: clean(String(x.title ?? '')),
    date: String(x.date ?? ''),
    url: String(x.url ?? ''),
    source: String(x.mediaName ?? x.source ?? ''),
    sentiment: classifySentiment(clean(String(x.title ?? ''))),
  })).filter((x) => x.title && x.url);
}

// 取某资产背景动态:多关键词各拉一批 → 按 url 去重 → 按时间倒序 → 截 limit。
export async function getAssetNews(assetId: string, limit = 12): Promise<NewsItem[]> {
  const cfg = getAssetConfig(assetId);
  const keywords = cfg?.newsKeywords;
  if (!keywords || keywords.length === 0) return [];

  const perKeyword = Math.max(4, Math.ceil(limit / keywords.length) + 2);
  const results = await Promise.all(
    keywords.map(async (kw) => {
      const cached = cache.get(kw);
      if (cached && Date.now() - cached.ts < TTL_MS) return cached.items;
      try {
        const items = await fetchNews(kw, perKeyword);
        cache.set(kw, { ts: Date.now(), items });
        return items;
      } catch {
        return cached?.items ?? [];
      }
    }),
  );

  // 按 url 去重(不同关键词可能命中同一篇)
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const items of results) {
    for (const it of items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      merged.push(it);
    }
  }
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return merged.slice(0, limit);
}
