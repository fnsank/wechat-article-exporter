import { setPreferences } from '~/server/kv/preferences';
import { requireAdminKey } from '~/server/utils/auth';
import type { Preferences } from '~/types/preferences';

export default defineEventHandler(async event => {
  requireAdminKey(event);
  const body = await readBody<Preferences>(event);
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid preferences payload' });
  }
  await setPreferences(body);
  return { code: 0 };
});
