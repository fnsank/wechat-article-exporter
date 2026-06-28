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

export function isAdminKeyValid(event: H3Event): boolean {
  const runtimeConfig = useRuntimeConfig();
  return matchesConfiguredKey(getSubmittedKey(event, 'X-Admin-Key', 'admin_key'), String(runtimeConfig.adminKey || ''));
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
  const runtimeConfig = useRuntimeConfig();
  return matchesConfiguredKey(getSubmittedKey(event, 'X-API-Key', 'api_key'), String(runtimeConfig.apiKey || ''));
}

export function requireApiKey(event: H3Event): void {
  if (!isApiKeyValid(event)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid API key',
    });
  }
}
