import type { Preferences } from '~/types/preferences';

const PREFERENCES_KEY = 'preferences:default';

export async function getPreferences(): Promise<Preferences | null> {
  const kv = useStorage('kv');
  return await kv.get<Preferences>(PREFERENCES_KEY);
}

export async function setPreferences(data: Preferences): Promise<void> {
  const kv = useStorage('kv');
  await kv.set<Preferences>(PREFERENCES_KEY, data);
}
