import { isAdminKeyValid, isApiKeyValid } from '~/server/utils/auth';
import { searchSogouArticles } from '~/server/utils/sogou';

interface SearchQuery {
  q?: string;
  page?: string;
  begin_time?: string;
  end_time?: string;
}

// 简单的每分钟限速，防止把 CF 出口 IP 玩烂
const RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_KV_PREFIX = 'rate:search-articles:';

/**
 * 用 djb2 派生一个短哈希作为限速 key 的一部分，避免把 raw key 明文写进 KV。
 */
function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function checkAndIncrementRate(identityKey: string): Promise<{ allowed: boolean; count: number }> {
  const kv = useStorage('kv');
  const minute = Math.floor(Date.now() / 60_000);
  const key = `${RATE_LIMIT_KV_PREFIX}${shortHash(identityKey)}:${minute}`;
  const current = (await kv.get<number>(key)) || 0;
  if (current >= RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, count: current };
  }
  await kv.set(key, current + 1, { ttl: 120 });
  return { allowed: true, count: current + 1 };
}

function getIdentity(event: any): string | null {
  const apiKey = getRequestHeader(event, 'X-API-Key');
  if (apiKey) return `api:${apiKey}`;
  const adminKey = getRequestHeader(event, 'X-Admin-Key');
  if (adminKey) return `admin:${adminKey}`;
  return null;
}

export default defineEventHandler(async event => {
  // 鉴权：X-API-Key 或 X-Admin-Key 二选一
  if (!isApiKeyValid(event) && !isAdminKeyValid(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Missing or invalid X-API-Key / X-Admin-Key' });
  }

  const identity = getIdentity(event);
  if (!identity) {
    throw createError({ statusCode: 401, statusMessage: 'Missing identity header' });
  }

  const rate = await checkAndIncrementRate(identity);
  if (!rate.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: `Rate limit exceeded: ${RATE_LIMIT_PER_MINUTE} requests/minute`,
    });
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
    rate: { current: rate.count, limit: RATE_LIMIT_PER_MINUTE },
  };
});
