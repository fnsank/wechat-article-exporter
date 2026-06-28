/**
 * Wrapper around $fetch with no retry.
 */
export const request = $fetch.create({
  retry: 0,
  method: 'GET',
  async onRequest({ options }) {
    if (typeof window === 'undefined') {
      return;
    }

    const adminKey = window.localStorage.getItem('wechat-exporter:admin-key');
    if (!adminKey) {
      return;
    }

    const headers = new Headers(options.headers as HeadersInit);
    if (!headers.has('X-Admin-Key')) {
      headers.set('X-Admin-Key', adminKey);
    }
    options.headers = headers;
  },
  async onResponse({ request, response, options, error }) {},
  async onResponseError({ request, response, options, error }) {},
});
