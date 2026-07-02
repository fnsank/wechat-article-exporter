import { isAdminKeyValid, isApiKeyValid } from '~/server/utils/auth';
import { searchSogouArticles } from '~/server/utils/sogou';

interface SearchQuery {
  q?: string;
  page?: string;
  begin_time?: string;
  end_time?: string;
}

export default defineEventHandler(async event => {
  // 鉴权：X-API-Key 或 X-Admin-Key 二选一
  if (!isApiKeyValid(event) && !isAdminKeyValid(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Missing or invalid X-API-Key / X-Admin-Key' });
  }

  const query = getQuery<SearchQuery>(event);
  const q = (query.q || '').trim();
  if (!q) {
    return {
      code: -1,
      err_msg: 'q 参数不能为空',
    };
  }

  const page = Math.max(1, Number(query.page) || 1);
  const beginTime = query.begin_time ? Number(query.begin_time) : null;
  const endTime = query.end_time ? Number(query.end_time) : null;

  const result = await searchSogouArticles(q, page);

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
    if (a.create_time === null) return true; // 没解析出时间的保守保留
    if (beginTime !== null && a.create_time < beginTime) return false;
    if (endTime !== null && a.create_time > endTime) return false;
    return true;
  });

  return {
    code: 0,
    articles: filtered,
    total: filtered.length,
    total_before_filter: result.articles.length,
    page,
    elapsedMs: result.elapsedMs,
  };
});
