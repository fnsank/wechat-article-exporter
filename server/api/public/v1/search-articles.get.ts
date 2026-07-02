import { isAdminKeyValid, isApiKeyValid } from '~/server/utils/auth';
import { MAX_PAGE_SIZE, searchAndResolveSogouArticles } from '~/server/utils/sogou';

interface SearchQuery {
  q?: string;
  page?: string;
  page_size?: string;
  begin_time?: string;
  end_time?: string;
}

/**
 * 关键字文章搜索。
 *
 * API 消费者拿到的 articles[].link 已经是真实 mp.weixin.qq.com/s?... 链接，
 * 服务端在同一 HTTP session 内完成 Sogou 搜索 → 解析跳转链，无需二次请求。
 *
 * Query 参数：
 *   q            必填，关键词
 *   page         可选，默认 1
 *   page_size    可选，10/20/30/50，默认 10。> 10 时后端会拼接多个 sogou 页
 *   begin_time   可选，unix 秒
 *   end_time     可选，unix 秒
 */
export default defineEventHandler(async event => {
  if (!isApiKeyValid(event) && !isAdminKeyValid(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Missing or invalid X-API-Key / X-Admin-Key' });
  }

  const query = getQuery<SearchQuery>(event);
  const q = (query.q || '').trim();
  if (!q) return { code: -1, err_msg: 'q 参数不能为空' };

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(10, Math.min(MAX_PAGE_SIZE, Number(query.page_size) || 10));
  const beginTime = query.begin_time ? Number(query.begin_time) : null;
  const endTime = query.end_time ? Number(query.end_time) : null;

  const result = await searchAndResolveSogouArticles(q, page, pageSize);

  if (!result.ok) {
    return {
      code: -1,
      err_msg: `Sogou 搜索失败：${result.reason} — ${result.message}`,
      reason: result.reason,
      elapsedMs: result.elapsedMs,
    };
  }

  // 时间过滤（sogou 不支持 since/until 参数，只能拿到结果后自己过滤）
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
    page: result.page,
    page_size: result.pageSize,
    total_pages: result.totalPages,
    // Sogou 页顶部宣传的"共 XXX 条"总数；未登录状态下 total_pages * 10 才是
    // 我们能实际拉到的上限，通常远小于 total_results
    total_results: result.totalResults,
    elapsedMs: result.elapsedMs,
  };
});
