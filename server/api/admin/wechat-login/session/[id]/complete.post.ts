import { requireAdminKey } from '~/server/utils/auth';
import { completeWechatLoginSession } from '~/server/utils/wechat-login';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const { id } = event.context.params!;
  const account = await completeWechatLoginSession(event, id);
  return {
    code: 0,
    data: account,
  };
});
