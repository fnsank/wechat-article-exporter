import { type AccountRef, setAccounts } from '~/server/kv/accounts';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const body = await readBody<AccountRef[]>(event);
  if (!Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected an array of accounts' });
  }
  // 过滤非法项 & 只保留身份字段
  const cleaned: AccountRef[] = body
    .filter(item => item && typeof item.fakeid === 'string' && item.fakeid.length > 0)
    .map(item => ({
      fakeid: item.fakeid,
      nickname: item.nickname,
      round_head_img: item.round_head_img,
    }));
  await setAccounts(cleaned);
  return { code: 0, count: cleaned.length };
});
