import { clearCurrentWechatSession, getCurrentWechatSession } from '~/server/kv/wechat-session';
import { requireAdminKey } from '~/server/utils/auth';
import { cookieStore } from '~/server/utils/CookieStore';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const session = await getCurrentWechatSession();
  if (session) {
    cookieStore.removeCookie(session.authKey);
  }
  await clearCurrentWechatSession();

  return {
    code: 0,
  };
});
