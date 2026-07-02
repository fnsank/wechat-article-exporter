/**
 * 诊断端点：从当前部署环境（CF Workers / Vercel / Docker）的出口 IP 打一次
 * Sogou 微信搜索页，判断能否绕过反爬。
 *
 * 用法（需 admin key）：
 *   GET /api/admin/diag/sogou?q=微信
 *
 * 返回结构：
 *   {
 *     verdict: 'success' | 'antispider' | 'unknown',
 *     ...细节
 *   }
 */
import * as cheerio from 'cheerio';
import { requireAdminKey } from '~/server/utils/auth';

const SEARCH_URL_TEMPLATE = 'https://weixin.sogou.com/weixin?type=2&query={q}&page=1';

// 拟真浏览器 header，避免因 UA 直接被 block
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://weixin.sogou.com/',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
};

function analyze(html: string, finalUrl: string) {
  const lowerHtml = html.toLowerCase();
  const lowerUrl = finalUrl.toLowerCase();

  // 反爬信号
  if (
    lowerUrl.includes('/antispider') ||
    lowerHtml.includes('访问过于频繁') ||
    lowerHtml.includes('用户您好') ||
    (lowerHtml.includes('验证码') && lowerHtml.includes('sogou')) ||
    lowerHtml.includes('antispider')
  ) {
    return { verdict: 'antispider', reason: '返回反爬页 / URL 含 /antispider / 页面提到验证码' };
  }

  // 成功信号：Sogou 微信搜索结果的常见 DOM
  const $ = cheerio.load(html);
  const results = $('.news-list > li, .news-box .news-list li, [id^="sogou_vr_"]');
  if (results.length > 0) {
    const firstTitle = $(results[0]).find('h3 a, h4 a').first().text().trim().slice(0, 80);
    return {
      verdict: 'success',
      resultCount: results.length,
      firstTitle: firstTitle || '(无标题)',
    };
  }

  // 其它情况：内容不明
  return {
    verdict: 'unknown',
    reason: '既没有反爬关键字，也没匹配到结果列表的 DOM',
  };
}

export default defineEventHandler(async event => {
  requireAdminKey(event);

  const query = getQuery(event);
  const q = typeof query.q === 'string' && query.q.trim() ? query.q.trim() : '微信';
  const url = SEARCH_URL_TEMPLATE.replace('{q}', encodeURIComponent(q));

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
  } catch (e: any) {
    return {
      verdict: 'network-error',
      error: String(e?.message || e),
      elapsedMs: Date.now() - started,
      requestedUrl: url,
    };
  }

  const html = await response.text();
  const analysis = analyze(html, response.url);

  return {
    ...analysis,
    keyword: q,
    requestedUrl: url,
    finalUrl: response.url,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type'),
    contentLength: html.length,
    setCookieCount: response.headers.getSetCookie().length,
    elapsedMs: Date.now() - started,
    // 前 500 字节的原始 HTML 片段，方便人工判断
    htmlSnippet: html.slice(0, 500),
  };
});
