import { listWechatCredentials } from '~/server/kv/wechat-credentials';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  return {
    code: 0,
    data: await listWechatCredentials(),
  };
});
