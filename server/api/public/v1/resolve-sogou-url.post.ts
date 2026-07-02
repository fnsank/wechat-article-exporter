import { isAdminKeyValid, isApiKeyValid } from '~/server/utils/auth';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://weixin.sogou.com/',
};

/**
 * Sogou 的 /link?url=<加密> 页面返回一段 JS，把真实的 mp.weixin.qq.com/s?... URL
 * 拼装/替换后 window.location.replace 过去。我们不能真的执行 JS，但可以正则捞出
 * 那些 mp URL 片段并拼回来。
 *
 * 常见形态：
 *   1) 完整字符串直给：
 *        <script>window.location.replace("https://mp.weixin.qq.com/s?__biz=xxx&mid=..&idx=..&sn=..");</script>
 *   2) 分段字符串拼接：
 *        var url = '';
 *        url += 'https://mp.weixin';
 *        url += '.qq.com/s?src=11';
 *        url += '&timestamp=...';
 *        url += '&ver=...';
 *        ...
 *        location.href = url + '';
 */
function extractMpUrl(html: string): string | null {
  // 直接一整段
  const directMatch =
    html.match(/location\.(?:href|replace)\s*=\s*["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']/i) ||
    html.match(/location\.replace\(["']([^"']*mp\.weixin\.qq\.com\/s[^"']*)["']\)/i);
  if (directMatch) return directMatch[1];

  // 拼接式：捞所有 url += '...' 片段拼回来
  const concatMatches = [...html.matchAll(/url\s*\+=\s*['"]([^'"]*)['"]\s*;/g)];
  if (concatMatches.length > 0) {
    const assembled = concatMatches.map(m => m[1]).join('');
    if (assembled.includes('mp.weixin.qq.com/s')) return assembled;
  }

  // 兜底：文档里裸露的 mp.weixin.qq.com/s?... 单串
  const naked = html.match(/https?:\/\/mp\.weixin\.qq\.com\/s\?[^"'\s<>]+/);
  if (naked) return naked[0];

  return null;
}

interface Body {
  urls?: string[];
}

interface ResolveItem {
  source: string;
  target: string | null;
  status?: number;
  error?: string;
}

export default defineEventHandler(async event => {
  // 鉴权：X-API-Key 或 X-Admin-Key 二选一
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

  const results: ResolveItem[] = await Promise.all(
    urls.map(async source => {
      try {
        const resp = await fetch(source, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        });
        // 优先看最终 URL 是不是已经跳到了 mp.weixin
        if (resp.url.includes('mp.weixin.qq.com/s')) {
          return { source, target: resp.url, status: resp.status };
        }
        const html = await resp.text();
        const target = extractMpUrl(html);
        return { source, target, status: resp.status };
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
    results,
  };
});
