import { getWechatCredential } from '~/server/kv/wechat-credentials';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const { biz } = event.context.params!;
  return {
    code: 0,
    data: await getWechatCredential(biz),
  };
});
