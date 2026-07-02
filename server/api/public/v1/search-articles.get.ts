import { isAdminKeyValid, isApiKeyValid } from '~/server/utils/auth';
import { searchAndResolveSogouArticles } from '~/server/utils/sogou';

interface SearchQuery {
  q?: string;
  page?: string;
  begin_time?: string;
  end_time?: string;
}

/**
 * 关键字文章搜索。
 *
 * 数据来源：Sogou 微信搜索页 + 服务端同 session 内解析 sogou 跳转链拿到真实
 * mp.weixin.qq.com/s?... URL。API 消费者拿到的 articles[].link 已经是真实
 * 微信原文链接，可直接用于下游抓取/解析。
 */
export default defineEventHandler(async event => {
  if (!isApiKeyValid(event) && !isAdminKeyValid(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Missing or invalid X-API-Key / X-Admin-Key' });
  }

  const query = getQuery<SearchQuery>(event);
  const q = (query.q || '').trim();
  if (!q) {
    return { code: -1, err_msg: 'q 参数不能为空' };
  }

  const page = Math.max(1, Number(query.page) || 1);
  const beginTime = query.begin_time ? Number(query.begin_time) : null;
  const endTime = query.end_time ? Number(query.end_time) : null;

  const result = await searchAndResolveSogouArticles(q, page);

  if (!result.ok) {
    return {
      code: -1,
      err_msg: `Sogou 搜索失败：${result.reason} — ${result.message}`,
      reason: result.reason,
      elapsedMs: result.elapsedMs,
    };
  }

  // 时间过滤：sogou 不支持服务端 since/until 参数，只能拿到结果后自己过滤
  const filtered = result.articles.filter(a => {
    if (a.create_time === null) return true;
    if (beginTime !== null && a.create_time < beginTime) return false;
    if (endTime !== null && a.create_time > endTime) return false;
    return true;
  });

  return {
    code: 0,
    articles: filtered,
    total: filtered.length,
    total_before_filter: result.articles.length,
    resolved: filtered.filter(a => a.link).length,
    page,
    elapsedMs: result.elapsedMs,
  };
});
