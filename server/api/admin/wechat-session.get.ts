import { getCurrentWechatSession, isCurrentWechatSessionExpired } from '~/server/kv/wechat-session';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const session = await getCurrentWechatSession();
  return {
    code: 0,
    data: session
      ? {
          ...session,
          expired: isCurrentWechatSessionExpired(session),
        }
      : null,
  };
});
