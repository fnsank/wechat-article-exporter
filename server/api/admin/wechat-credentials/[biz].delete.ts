import { deleteWechatCredential } from '~/server/kv/wechat-credentials';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const { biz } = event.context.params!;
  await deleteWechatCredential(biz);
  return {
    code: 0,
  };
});
