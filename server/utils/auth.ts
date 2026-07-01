import { createError, getQuery, getRequestHeader, type H3Event } from 'h3';

function getSubmittedKey(event: H3Event, headerName: string, queryName: string): string {
  const headerValue = getRequestHeader(event, headerName);
  if (headerValue) {
    return headerValue;
  }

  const query = getQuery(event);
  const queryValue = query[queryName];
  return typeof queryValue === 'string' ? queryValue : '';
}

function matchesConfiguredKey(submitted: string, expected?: string): boolean {
  return Boolean(expected && submitted && submitted === expected);
}

/**
 * 统一优先读运行时 process.env，回退到 build 时烧进 runtimeConfig 的值。
 *
 * 目的：让 CF Workers（Runtime Variables 里改）与 Vercel（Env Vars 里改）用
 * 同一个变量名 ADMIN_KEY / API_KEY 就能生效，不需要为 CF 单独用 NUXT_
 * 前缀（那是 Nuxt runtimeConfig 的运行时覆盖约定，跟 Vercel 不一致）。
 *
 * - CF Workers：compatibility_date=2025-10-30 + nodejs_compat 让 CF Dashboard
 *   里的 Runtime Variable 自动 populate 到 process.env
 * - Vercel：serverless Node 环境 process.env 天然有
 * - Docker：docker run -e 传的直接就是 process.env
 */
function resolveConfiguredKey(processEnvKey: string, runtimeConfigKey: 'adminKey' | 'apiKey'): string {
  if (typeof process !== 'undefined' && process.env && process.env[processEnvKey]) {
    return String(process.env[processEnvKey]);
  }
  const runtimeConfig = useRuntimeConfig();
  return String(runtimeConfig[runtimeConfigKey] || '');
}

export function isAdminKeyValid(event: H3Event): boolean {
  return matchesConfiguredKey(getSubmittedKey(event, 'X-Admin-Key', 'admin_key'), resolveConfiguredKey('ADMIN_KEY', 'adminKey'));
}

export function requireAdminKey(event: H3Event): void {
  if (!isAdminKeyValid(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid admin key',
    });
  }
}

export function isApiKeyValid(event: H3Event): boolean {
  return matchesConfiguredKey(getSubmittedKey(event, 'X-API-Key', 'api_key'), resolveConfiguredKey('API_KEY', 'apiKey'));
}

export function requireApiKey(event: H3Event): void {
  if (!isApiKeyValid(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid API key',
    });
  }
}
