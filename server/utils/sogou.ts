import * as cheerio from 'cheerio';

const SEARCH_URL_TEMPLATE = 'https://weixin.sogou.com/weixin?type=2&query={q}&page={p}&ie=utf8';

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
  // sogou 的跳转链，浏览器打开会 302 到真实文章。API 消费者一般不需要它，保留供调试
  sogou_url: string;
  // 真实的 mp.weixin.qq.com/s?... 链接，解析失败时为 null
  link: string | null;
  // 从 mp URL 的 __biz 参数解析出的 fakeid（base64 编码字符串）
  fakeid: string | null;
  // 从 mp URL 的 sn 参数解析出的短哈希，可作 article id
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

/**
 * 从搜索页响应的 Set-Cookie 头里挑出会话相关 cookie，拼成 Cookie 请求头字符串。
 * sogou /link 页需要带 SNUID/SUV 等才能拿到真实 mp URL，不带就 302 到 antispider。
 * 同一 session 内 SNUID 与搜索页返回的 token 匹配，反爬门槛最低。
 */
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

/**
 * 从 sogou /link 页的响应 HTML 里提取 mp.weixin.qq.com/s?... URL。
 * sogou 有几种嵌入形态：
 *   1) location.replace("https://mp.weixin.qq.com/s?...")
 *   2) 分段拼接：var url=''; url+='https://mp.weixin'; url+='.qq.com/s?...';
 *   3) <meta http-equiv="refresh" content="0; url=https://mp.weixin.qq.com/s?...">
 */
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
 * 在同一 HTTP session 里完成"搜索 → 逐条解析 sogou /link → 拿到真实 mp URL"。
 *
 * 关键：sogou /link URL 里的 token 参数是搜索页返回时跟当时 SNUID 绑定的。
 * 只有用同一份 SNUID 请求 /link，token 校验才能过，否则 302 到 antispider。
 * 服务端搜完立刻用返回的 Set-Cookie 请求每个 /link，能极大提高成功率。
 */
export async function searchAndResolveSogouArticles(keyword: string, page = 1): Promise<SogouSearchResult> {
  const url = SEARCH_URL_TEMPLATE.replace('{q}', encodeURIComponent(keyword)).replace('{p}', String(page));
  const started = Date.now();

  // Step 1: 搜索
  let searchResp: Response;
  try {
    searchResp = await fetch(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
  } catch (e: any) {
    return {
      ok: false,
      reason: 'network-error',
      message: String(e?.message || e),
      elapsedMs: Date.now() - started,
    };
  }

  const html = await searchResp.text();

  if (isAntiSpider(html, searchResp.url)) {
    return {
      ok: false,
      reason: 'antispider',
      message: 'Sogou 搜索页触发反爬（验证码/频率限制）',
      status: searchResp.status,
      finalUrl: searchResp.url,
      elapsedMs: Date.now() - started,
    };
  }

  let parsed: ParsedSearchItem[];
  try {
    parsed = parseSearchResults(html);
  } catch (e: any) {
    return {
      ok: false,
      reason: 'parse-error',
      message: String(e?.message || e),
      status: searchResp.status,
      finalUrl: searchResp.url,
      elapsedMs: Date.now() - started,
    };
  }

  // Step 2: 用搜索响应的会话 cookie 并行解析每条 /link
  const sessionCookie = extractSessionCookies(searchResp.headers.getSetCookie());
  const linkHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    Referer: searchResp.url,
  };
  if (sessionCookie) linkHeaders.Cookie = sessionCookie;

  const articles: SogouArticle[] = await Promise.all(
    parsed.map(async item => {
      let link: string | null = null;
      try {
        const linkResp = await fetch(item.sogou_url, {
          method: 'GET',
          headers: linkHeaders,
          redirect: 'follow',
        });

        // 优先看最终跳转的 URL 是否已经是 mp.weixin
        if (linkResp.url.includes('mp.weixin.qq.com/s')) {
          link = linkResp.url;
        } else if (!linkResp.url.includes('/antispider')) {
          const linkHtml = await linkResp.text();
          link = extractMpUrl(linkHtml);
        }
      } catch {
        // 单条失败不影响整体，link 保持 null
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
    })
  );

  const resolved = articles.filter(a => a.link).length;
  return {
    ok: true,
    articles,
    total: articles.length,
    resolved,
    page,
    elapsedMs: Date.now() - started,
  };
}
