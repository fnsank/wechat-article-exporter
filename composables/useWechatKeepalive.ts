import { request } from '#shared/utils/request';

const HEARTBEAT_INTERVAL_MS = 25 * 60 * 1000; // 25 分钟

interface InfoResponse {
  nick_name: string;
  head_img: string;
  error?: string;
}

/**
 * 微信登录会话心跳。
 *
 * 微信服务端下发的 cookie 常仅 2~4 小时有效；只要有请求打到微信，微信响应
 * 里的 Set-Cookie 就会被 server/utils/proxy-request.ts 的 updateCookies
 * 自动续写回 KV。所以只要 dashboard 页面开着，我们代替用户每 25 分钟 ping
 * 一次 /api/web/mp/info 就能保持会话新鲜。ping 失败或返回空信息时立即清掉
 * loginAccount，UI 会引导重新扫码。
 *
 * 局限：页面关闭时无法续命 —— 那种情况需要 serverless cron，Vercel 免费
 * 版每天一次不够用，Cloudflare Cron Triggers 才够（若后续迁移到 Pages）。
 */
export default function useWechatKeepalive() {
  const loginAccount = useLoginAccount();
  let timer: number | null = null;
  let visibilityHandler: (() => void) | null = null;

  async function ping() {
    if (!loginAccount.value) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    try {
      const resp = await request<InfoResponse>('/api/web/mp/info');
      if (resp?.error || !resp?.nick_name) {
        // 微信已判定会话过期
        loginAccount.value = null;
      }
    } catch (e) {
      // 网络失败静默，下轮再试
    }
  }

  function start() {
    if (timer !== null) return;
    timer = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);

    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        ping();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  function stop() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  }

  return { start, stop, ping };
}
