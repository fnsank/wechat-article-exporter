import { USER_AGENT } from '~/config';
import {
  clearCurrentWechatSession,
  getCurrentWechatSession,
  isCurrentWechatSessionExpired,
} from '~/server/kv/wechat-session';
import { cookieStore } from '~/server/utils/CookieStore';

/**
 * Cloudflare Workers Cron 定时触发（每 5 分钟）。
 *
 * 微信登录 cookie（slave_sid / data_ticket 等）常仅 2~4 小时有效；只要有
 * 请求打到微信，微信响应里的 Set-Cookie 就会续期。这个任务代替用户去 ping
 * 一次 mp home 页面，保持后端持久化的会话新鲜 —— 即便浏览器关着也能续。
 *
 * 只在 preset=cloudflare_module 且部署到 Cloudflare Workers 时才有实际
 * 效果；其它 preset（如 Vercel）没有 cron 触发机制，此文件仅作代码保留。
 */
export default defineTask({
  meta: {
    name: 'wechat-heartbeat',
    description: '定时刷新后端微信登录 cookie，避免会话在浏览器关闭期间过期',
  },

  async run() {
    const session = await getCurrentWechatSession();
    if (!session) {
      return { result: 'no-session' };
    }
    if (isCurrentWechatSessionExpired(session)) {
      await clearCurrentWechatSession();
      return { result: 'session-expired-cleared' };
    }

    const authKey = session.authKey;
    const cookie = await cookieStore.getCookie(authKey);
    const token = await cookieStore.getToken(authKey);
    if (!cookie || !token) {
      await clearCurrentWechatSession();
      return { result: 'cookie-store-empty-cleared' };
    }

    // 打一次微信 home 页面，走完整的 cookie 请求/响应交换
    const endpoint = `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=${encodeURIComponent(token)}&lang=zh_CN`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Referer: 'https://mp.weixin.qq.com/',
          Origin: 'https://mp.weixin.qq.com',
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'identity',
          Cookie: cookie,
        },
        redirect: 'manual',
      });
    } catch (e) {
      // 网络失败，下次 cron 再试
      return { result: 'fetch-failed', error: String(e) };
    }

    // 微信 session 失效通常会 302 到登录页；正常返回是 200 且带 nick_name 的 HTML
    if (response.status >= 300 && response.status < 400) {
      // 重定向 = 登录失效
      await clearCurrentWechatSession();
      return { result: 'wechat-redirected-cleared', status: response.status };
    }

    // 把微信响应里的 Set-Cookie 续写回 KV
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      await cookieStore.updateCookie(authKey, setCookies);
    }

    const html = await response.text();
    if (!/wx\.cgiData\.nick_name/.test(html)) {
      // 返回的 HTML 里没有账号信息 = 登录已失效
      await clearCurrentWechatSession();
      return { result: 'nickname-missing-cleared' };
    }

    return { result: 'ok', status: response.status };
  },
});
