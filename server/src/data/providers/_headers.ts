// 统一的拟人化请求头 —— 反反爬基本功。
// 金融数据接口(新浪/东方财富/天天基金)普遍校验 User-Agent 与 Referer,
// 裸 fetch(Node 默认 UA 含 "node-fetch"/无 UA)或自曝身份(如 "radar-server")
// 会被识别为机器流量而拒绝/限流。这里统一用真实 Chrome 桌面 UA + 完整请求头。
//
// 注意:这只解决 HTTP 层指纹。TLS 层 JA3 指纹仍是 Node OpenSSL(部分严格接口如
// 东方财富 push2his 行情接口会按 JA3 拦截,需上层用近似数据源兜底)。

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 构造完整浏览器请求头。referer 按目标站点填(新浪/东财基金/东财行情各不同)。
export function browserHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': CHROME_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    // sec-ch-ua 系列是现代 Chrome 必带,缺失会被识别为非浏览器
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'upgrade-insecure-requests': '1',
  };
  if (referer) h.Referer = referer;
  return h;
}
