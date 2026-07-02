import * as cheerio from 'cheerio';

const SEARCH_URL_TEMPLATE = 'https://weixin.sogou.com/weixin?type=2&query={q}&page={p}&ie=utf8';

// Sogou 一页固定 10 条，我们通过多次请求相邻 sogou 页拼接来实现更大的逻辑 pageSize
const SOGOU_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

const BROWSER_HEADERS: Record<string, string> = {
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

export interface SogouArticle {
  title: string;
  abstract: string;
  cover_url: string;
  sogou_url: string;
  link: string | null;
  fakeid: string | null;
  sn: string | null;
  account_nickname: string;
  create_time: number | null;
}

export type SogouSearchResult =
  | {
      ok: true;
      articles: SogouArticle[];
      total: number;
      resolved: number;
      page: number;
      pageSize: number;
      totalPages: number | null;
      // Sogou 页顶部宣传的"共 XXX 条结果"数字。跟 totalPages 不同——
      // 未登录用户翻页深度被限制在约 10 页（100 条），所以 totalResults
      // 常远大于实际能拉到的数据量
      totalResults: number | null;
      elapsedMs: number;
    }
  | {
      ok: false;
      reason: 'antispider' | 'network-error' | 'parse-error';
      message: string;
      status?: number;
      finalUrl?: string;
      elapsedMs: number;
    };

function isAntiSpider(html: string, finalUrl: string): boolean {
  const lowerUrl = finalUrl.toLowerCase();
  const lowerHtml = html.toLowerCase();
  if (lowerUrl.includes('/antispider')) return true;
  if (lowerHtml.includes('antispider')) return true;
  if (lowerHtml.includes('访问过于频繁')) return true;
  if (lowerHtml.includes('用户您好') && lowerHtml.includes('验证码')) return true;
  return false;
}

function extractSessionCookies(setCookies: string[]): string {
  const keep = new Set(['SNUID', 'SUV', 'SUID', 'IPLOC', 'ABTEST', 'CXID', 'SMYUV']);
  const parts: string[] = [];
  for (const line of setCookies) {
    const first = line.split(';')[0].trim();
    if (!first) continue;
    const name = first.split('=')[0];
    if (keep.has(name)) parts.push(first);
  }
  return parts.join('; ');
}

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#x2f;/gi, '/').replace(/&quot;/g, '"');
}

function extractMpUrl(html: string): string | null {
  const directMatch =
    html.match(/location\.(?:href|replace)\s*=\s*["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']/i) ||
    html.match(/location\.replace\(["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']\)/i) ||
    html.match(/window\.location\s*=\s*["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']/i);
  if (directMatch) return decodeHtml(directMatch[1]);

  const concatMatches = [...html.matchAll(/url\s*\+=\s*['"]([^'"]*)['"]\s*;/g)];
  if (concatMatches.length > 0) {
    const assembled = concatMatches.map(m => m[1]).join('');
    if (assembled.includes('mp.weixin.qq.com/s')) return decodeHtml(assembled);
  }

  const metaMatch = html.match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>]+mp\.weixin\.qq\.com\/s[^"'>]+)/i
  );
  if (metaMatch) return decodeHtml(metaMatch[1]);

  const naked = html.match(/https?:\/\/mp\.weixin\.qq\.com\/s\?[^"'\s<>]+/);
  if (naked) return decodeHtml(naked[0]);

  return null;
}

interface ParsedSearchItem {
  title: string;
  abstract: string;
  cover_url: string;
  sogou_url: string;
  account_nickname: string;
  create_time: number | null;
}

function parseSearchResults(html: string): ParsedSearchItem[] {
  const $ = cheerio.load(html);
  const items = $('.news-list > li');
  const results: ParsedSearchItem[] = [];

  items.each((_, el) => {
    const $el = $(el);
    const titleAnchor = $el.find('h3 a, h4 a').first();
    const title = titleAnchor.text().trim();
    if (!title) return;

    let redirect = titleAnchor.attr('href') || '';
    if (redirect.startsWith('/')) redirect = `https://weixin.sogou.com${redirect}`;

    const abstract = $el.find('.txt-info, .txt-box p').first().text().trim();
    const cover =
      $el.find('.img-box img').first().attr('src') ||
      $el.find('img[src*="mmbiz.qpic.cn"], img[src*="wx.qlogo.cn"]').first().attr('src') ||
      '';
    const coverUrl = cover.startsWith('//') ? `https:${cover}` : cover;

    const $sp = $el.find('.s-p').first();
    let accountName = $sp.find('.all-time-y2').first().text().trim();
    if (!accountName) accountName = $sp.find('a.account, .account').first().text().trim();
    if (!accountName) accountName = $sp.find('a').first().text().trim();
    if (!accountName) accountName = $sp.find('span').first().text().trim();

    let createTime: number | null = null;
    const timeText = $el.find('.s2, .s3, [id^="sogou_vr_"] .s2').first().text().trim();
    if (/^\d{10}$/.test(timeText)) createTime = Number(timeText);
    if (createTime === null) {
      const scriptText = $el.html() || '';
      const m = scriptText.match(/timeConvert\('(\d{10})'\)/);
      if (m) createTime = Number(m[1]);
    }

    results.push({
      title,
      abstract,
      cover_url: coverUrl,
      sogou_url: decodeHtml(redirect),
      account_nickname: accountName,
      create_time: createTime,
    });
  });

  return results;
}

/**
 * 从 sogou 结果页顶部宣传文案里抽出"共 XXX 条结果"数字。
 * 常见样式：
 *   "为您找到相关结果约 943 个"
 *   "找到相关文章 43 篇"
 *   "共约 100 条"
 */
function extractTotalResults(html: string): number | null {
  const m = html.match(/(?:为您找到|找到|结果|共约|共)[^<>]{0,40}?(\d+(?:,\d+)*)\s*(?:个|篇|条)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 从 Sogou 搜索页 HTML 里提取"总 sogou 页数"。Sogou 一般在 #pagebar_container
 * 里放页码链接（uigs="page_1", "page_2" ...）。取最大 N 作为总页数。
 */
function extractSogouTotalPages(html: string): number | null {
  const $ = cheerio.load(html);
  const nums: number[] = [];
  $('#pagebar_container a, .p a').each((_, el) => {
    const uigs = $(el).attr('uigs') || '';
    const m = uigs.match(/page_(\d+)/);
    if (m) nums.push(Number(m[1]));
    // 兜底：href 里也可能有 &page=N
    const href = $(el).attr('href') || '';
    const m2 = href.match(/[?&]page=(\d+)/);
    if (m2) nums.push(Number(m2[1]));
  });
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

interface SogouPageFetch {
  ok: boolean;
  reason?: 'antispider' | 'network-error' | 'parse-error';
  message?: string;
  status?: number;
  finalUrl?: string;
  items?: ParsedSearchItem[];
  setCookies?: string[];
  sogouTotalPages?: number | null;
  totalResults?: number | null;
}

/**
 * 受控并发的 Promise.all —— 一次最多 `limit` 个任务在飞，避免瞬时爆发触发
 * sogou 反爬。批次处理策略：sliding window，前一个完成才启新的。
 */
async function limitedParallel<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing = new Set<Promise<void>>();
  for (let i = 0; i < items.length; i++) {
    const idx = i;
    const p = (async () => {
      results[idx] = await fn(items[idx], idx);
    })();
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}

// /link 解析的最大并发数。太高容易触发 sogou 反爬（尤其是 pageSize=50 场景），
// 太低响应会慢。5 是保守配置：50 个 link 大概需 3-4 秒完成。
const LINK_RESOLVE_CONCURRENCY = 5;

async function fetchSogouSearchPage(keyword: string, sogouPage: number, cookieHeader: string): Promise<SogouPageFetch> {
  const url = SEARCH_URL_TEMPLATE.replace('{q}', encodeURIComponent(keyword)).replace('{p}', String(sogouPage));
  const headers: Record<string, string> = { ...BROWSER_HEADERS };
  if (cookieHeader) headers.Cookie = cookieHeader;

  let resp: Response;
  try {
    resp = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
  } catch (e: any) {
    return { ok: false, reason: 'network-error', message: String(e?.message || e) };
  }

  const html = await resp.text();
  if (isAntiSpider(html, resp.url)) {
    return {
      ok: false,
      reason: 'antispider',
      message: 'Sogou 搜索页触发反爬',
      status: resp.status,
      finalUrl: resp.url,
    };
  }

  try {
    const items = parseSearchResults(html);
    const sogouTotalPages = extractSogouTotalPages(html);
    const totalResults = extractTotalResults(html);
    return {
      ok: true,
      items,
      setCookies: resp.headers.getSetCookie(),
      sogouTotalPages,
      totalResults,
      status: resp.status,
      finalUrl: resp.url,
    };
  } catch (e: any) {
    return { ok: false, reason: 'parse-error', message: String(e?.message || e) };
  }
}

/**
 * 端到端流程：
 *   1. 计算需要抓的 sogou 起始/结束页（每条逻辑页 = ⌈pageSize/10⌉ 个 sogou 页）
 *   2. 依次 fetch 各 sogou 页，收集 items + cookies + totalPages
 *   3. 用累积的 cookies 并行解析每条 item 的 /link → 真实 mp URL
 */
export async function searchAndResolveSogouArticles(
  keyword: string,
  page: number = 1,
  pageSize: number = SOGOU_PAGE_SIZE
): Promise<SogouSearchResult> {
  const started = Date.now();
  const effectivePageSize = Math.max(SOGOU_PAGE_SIZE, Math.min(pageSize, MAX_PAGE_SIZE));
  const sogouPagesPerLogical = Math.ceil(effectivePageSize / SOGOU_PAGE_SIZE);
  const startSogouPage = (Math.max(1, page) - 1) * sogouPagesPerLogical + 1;

  let cookieHeader = '';
  const allItems: ParsedSearchItem[] = [];
  let sogouTotalPages: number | null = null;
  let totalResults: number | null = null;
  let firstErrorLike: SogouPageFetch | null = null;

  for (let i = 0; i < sogouPagesPerLogical; i++) {
    const result = await fetchSogouSearchPage(keyword, startSogouPage + i, cookieHeader);
    if (!result.ok) {
      // 首页失败直接返回错误；后续页失败则忽略（可能是"没有更多结果"）
      if (i === 0) {
        return {
          ok: false,
          reason: result.reason || 'parse-error',
          message: result.message || 'unknown',
          status: result.status,
          finalUrl: result.finalUrl,
          elapsedMs: Date.now() - started,
        };
      }
      firstErrorLike = firstErrorLike || result;
      break;
    }
    // 累积 cookies（用于下一次 sogou 页请求和后续 /link 解析）
    if (result.setCookies && result.setCookies.length > 0) {
      const newCookies = extractSessionCookies(result.setCookies);
      if (newCookies) cookieHeader = newCookies;
    }
    if (i === 0) {
      if (result.sogouTotalPages) sogouTotalPages = result.sogouTotalPages;
      if (result.totalResults != null) totalResults = result.totalResults;
    }
    if (result.items) {
      allItems.push(...result.items);
      if (result.items.length < SOGOU_PAGE_SIZE) break; // 到底了
    }
  }

  // 逻辑总页数
  const logicalTotalPages = sogouTotalPages ? Math.ceil(sogouTotalPages / sogouPagesPerLogical) : null;

  // 用最终 cookies 受控并发解析每条 /link，避免瞬时爆发触发反爬
  const linkHeaders: Record<string, string> = { ...BROWSER_HEADERS };
  if (cookieHeader) linkHeaders.Cookie = cookieHeader;

  const articles: SogouArticle[] = await limitedParallel(allItems, LINK_RESOLVE_CONCURRENCY, async item => {
      let link: string | null = null;
      try {
        const linkResp = await fetch(item.sogou_url, {
          method: 'GET',
          headers: linkHeaders,
          redirect: 'follow',
        });
        if (linkResp.url.includes('mp.weixin.qq.com/s')) {
          link = linkResp.url;
        } else if (!linkResp.url.includes('/antispider')) {
          const linkHtml = await linkResp.text();
          link = extractMpUrl(linkHtml);
        }
      } catch {
        // 单条失败保留 null
      }

      const biz = link ? link.match(/[?&]__biz=([^&]+)/)?.[1] || null : null;
      const sn = link ? link.match(/[?&]sn=([^&]+)/)?.[1] || null : null;

      return {
        title: item.title,
        abstract: item.abstract,
        cover_url: item.cover_url,
        sogou_url: item.sogou_url,
        link,
        fakeid: biz,
        sn,
        account_nickname: item.account_nickname,
        create_time: item.create_time,
      };
    });

  const resolved = articles.filter(a => a.link).length;
  return {
    ok: true,
    articles,
    total: articles.length,
    resolved,
    page,
    pageSize: effectivePageSize,
    totalPages: logicalTotalPages,
    totalResults,
    elapsedMs: Date.now() - started,
  };
}
