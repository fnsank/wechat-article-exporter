import { createError, readBody } from 'h3';
import { setWechatCredential } from '~/server/kv/wechat-credentials';
import { requireAdminKey } from '~/server/utils/auth';
import type { ParsedCredential } from '~/types/credential';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const credential = await readBody<ParsedCredential>(event);
  if (!credential?.biz || !credential?.uin || !credential?.key || !credential?.pass_ticket) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Incomplete WeChat credential',
    });
  }

  await setWechatCredential({
    ...credential,
    timestamp: credential.timestamp || Date.now(),
    valid: credential.valid ?? true,
  });

  return {
    code: 0,
  };
});
