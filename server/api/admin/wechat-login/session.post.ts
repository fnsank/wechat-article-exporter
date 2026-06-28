import { requireAdminKey } from '~/server/utils/auth';
import { createWechatLoginSession } from '~/server/utils/wechat-login';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const session = await createWechatLoginSession(event);
  return {
    code: 0,
    data: session,
  };
});
