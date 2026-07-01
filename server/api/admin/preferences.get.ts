import { getPreferences } from '~/server/kv/preferences';
import { requireAdminKey } from '~/server/utils/auth';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const data = await getPreferences();
  return {
    code: 0,
    data,
  };
});
