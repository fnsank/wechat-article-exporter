import { isAdminKeyValid, isApiKeyValid } from '~/server/utils/auth';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://weixin.sogou.com/',
};

/**
 * 从 Set-Cookie header 数组里挑关键 cookie（SNUID / SUV / SUID）拼成一个
 * Cookie 请求头字符串。sogou 的 /link 页需要带这些才能拿到真实 mp URL；
 * 不带会 302 到 /antispider/。
 */
function extractCookies(setCookies: string[]): string {
  const parts: string[] = [];
  for (const line of setCookies) {
    const first = line.split(';')[0].trim();
    if (!first) continue;
    const name = first.split('=')[0];
    // 保留常见的会话 cookie，其它忽略（有些是过期或空的）
    if (['SNUID', 'SUV', 'SUID', 'IPLOC', 'ABTEST', 'CXID', 'SMYUV'].includes(name)) {
      parts.push(first);
    }
  }
  return parts.join('; ');
}

/**
 * Sogou 的 /link 返回一段 JS，把真实 mp.weixin.qq.com/s?... URL 拼装/替换后
 * window.location.replace 过去。有几种常见形态：
 *   1) 完整字符串直给：
 *        location.replace("https://mp.weixin.qq.com/s?__biz=xxx...");
 *   2) 分段字符串拼接：
 *        var url = ''; url += 'https://mp.weixin'; url += '.qq.com/s?src=11'; ...
 *   3) meta refresh：
 *        <meta http-equiv="refresh" content="0; url=https://mp.weixin.qq.com/s?...">
 */
function extractMpUrl(html: string): string | null {
  const directMatch =
    html.match(/location\.(?:href|replace)\s*=\s*["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']/i) ||
    html.match(/location\.replace\(["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']\)/i) ||
    html.match(/window\.location\s*=\s*["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']/i);
  if (directMatch) return decodeHtml(directMatch[1]);

  // 拼接式：捞所有 url += '...' 片段拼回来
  const concatMatches = [...html.matchAll(/url\s*\+=\s*['"]([^'"]*)['"]\s*;/g)];
  if (concatMatches.length > 0) {
    const assembled = concatMatches.map(m => m[1]).join('');
    if (assembled.includes('mp.weixin.qq.com/s')) return decodeHtml(assembled);
  }

  // meta refresh
  const metaMatch = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>]+mp\.weixin\.qq\.com\/s[^"'>]+)/i);
  if (metaMatch) return decodeHtml(metaMatch[1]);

  // 兜底：文档里裸露的 mp.weixin.qq.com/s?... 单串
  const naked = html.match(/https?:\/\/mp\.weixin\.qq\.com\/s\?[^"'\s<>]+/);
  if (naked) return decodeHtml(naked[0]);

  return null;
}

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#x2f;/gi, '/').replace(/&quot;/g, '"');
}

interface Body {
  urls?: string[];
}

interface ResolveItem {
  source: string;
  target: string | null;
  status?: number;
  error?: string;
  finalUrl?: string;
}

/**
 * 预热：GET sogou 微信搜索首页拿 Set-Cookie，用于后续 /link 请求带上。
 * sogou 会种 SNUID/SUV 等 session cookie，不带的话 /link 会 302 到 antispider。
 */
async function warmupCookies(): Promise<string> {
  try {
    const resp = await fetch('https://weixin.sogou.com/', {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    return extractCookies(resp.headers.getSetCookie());
  } catch {
    return '';
  }
}

export default defineEventHandler(async event => {
  if (!isApiKeyValid(event) && !isAdminKeyValid(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Missing or invalid X-API-Key / X-Admin-Key' });
  }

  const body = await readBody<Body>(event);
  const urls = Array.isArray(body?.urls) ? body.urls.filter(u => typeof u === 'string' && u.trim()) : [];
  if (urls.length === 0) {
    return { code: -1, err_msg: 'urls 数组不能为空' };
  }
  if (urls.length > 20) {
    return { code: -1, err_msg: '一次最多解析 20 条 URL' };
  }

  // 拿一份新鲜的 sogou session cookie
  const cookieHeader = await warmupCookies();
  const requestHeaders: Record<string, string> = { ...BROWSER_HEADERS };
  if (cookieHeader) requestHeaders.Cookie = cookieHeader;

  const results: ResolveItem[] = await Promise.all(
    urls.map(async source => {
      try {
        const resp = await fetch(source, {
          method: 'GET',
          headers: requestHeaders,
          redirect: 'follow',
        });

        // final URL 如果已经是 mp.weixin，直接返回
        if (resp.url.includes('mp.weixin.qq.com/s')) {
          return { source, target: resp.url, status: resp.status, finalUrl: resp.url };
        }
        // 302 到 antispider 就是反爬
        if (resp.url.includes('/antispider')) {
          return { source, target: null, status: resp.status, finalUrl: resp.url, error: 'antispider' };
        }

        const html = await resp.text();
        const target = extractMpUrl(html);
        return { source, target, status: resp.status, finalUrl: resp.url };
      } catch (e: any) {
        return { source, target: null, error: String(e?.message || e) };
      }
    })
  );

  const succeeded = results.filter(r => r.target).length;
  return {
    code: 0,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    hadWarmupCookies: cookieHeader.length > 0,
    results,
  };
});
