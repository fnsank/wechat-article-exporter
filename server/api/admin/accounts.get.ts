import { getAccounts } from '~/server/kv/accounts';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const data = await getAccounts();
  return {
    code: 0,
    data,
  };
});
