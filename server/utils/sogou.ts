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
  // sogou 的跳转链，浏览器打开会 302 到真实文章
  redirect_url: string;
  account_nickname: string;
  account_biz: string | null;
  create_time: number | null;
}

export type SogouSearchResult =
  | {
      ok: true;
      articles: SogouArticle[];
      total: number;
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
 * 解析 sogou 搜索页 HTML。sogou 的时间戳通常以 `document.write(timeConvert('1725000000'))`
 * 或类似形式散落在结果 DOM 里，需要正则捞。
 */
function parseSearchResults(html: string): SogouArticle[] {
  const $ = cheerio.load(html);
  const items = $('.news-list > li');
  const results: SogouArticle[] = [];

  items.each((_, el) => {
    const $el = $(el);

    const titleAnchor = $el.find('h3 a, h4 a').first();
    const title = titleAnchor.text().trim();
    if (!title) return;

    // sogou 的跳转链是相对路径 /link?url=...；补全成绝对 URL 供前端直接使用
    let redirect = titleAnchor.attr('href') || '';
    if (redirect.startsWith('/')) redirect = `https://weixin.sogou.com${redirect}`;

    const abstract = $el.find('.txt-info, .txt-box p').first().text().trim();
    const cover =
      $el.find('.img-box img').first().attr('src') ||
      $el.find('img[src*="mmbiz.qpic.cn"], img[src*="wx.qlogo.cn"]').first().attr('src') ||
      '';
    const coverUrl = cover.startsWith('//') ? `https:${cover}` : cover;

    const accountAnchor = $el.find('.account, .s-p a').first();
    const accountName = accountAnchor.text().trim();
    const accountHref = accountAnchor.attr('href') || '';
    // sogou 用 data-encgpid / data-openid 记账号 id；biz 需从跳转链的 __biz 参数解析（这里保守留空）
    const bizMatch = accountHref.match(/[?&]account=([^&]+)/);
    const accountBiz = bizMatch ? decodeURIComponent(bizMatch[1]) : null;

    // 时间：sogou 结果里通常是 <span class="s2">{unix秒}</span> 或 timeConvert('...')
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
      redirect_url: redirect,
      account_nickname: accountName,
      account_biz: accountBiz,
      create_time: createTime,
    });
  });

  return results;
}

export async function searchSogouArticles(keyword: string, page = 1): Promise<SogouSearchResult> {
  const url = SEARCH_URL_TEMPLATE.replace('{q}', encodeURIComponent(keyword)).replace('{p}', String(page));
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
      ok: false,
      reason: 'network-error',
      message: String(e?.message || e),
      elapsedMs: Date.now() - started,
    };
  }

  const html = await response.text();

  if (isAntiSpider(html, response.url)) {
    return {
      ok: false,
      reason: 'antispider',
      message: 'Sogou 触发反爬（验证码/频率限制）',
      status: response.status,
      finalUrl: response.url,
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const articles = parseSearchResults(html);
    return {
      ok: true,
      articles,
      total: articles.length,
      page,
      elapsedMs: Date.now() - started,
    };
  } catch (e: any) {
    return {
      ok: false,
      reason: 'parse-error',
      message: String(e?.message || e),
      status: response.status,
      finalUrl: response.url,
      elapsedMs: Date.now() - started,
    };
  }
}
