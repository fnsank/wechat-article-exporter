import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
  expiresAt?: string;
}

function getExpirationTtl(expiresAt?: string): number {
  if (!expiresAt) {
    return 60 * 60 * 24 * 4;
  }

  const seconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  return Math.max(seconds, 60);
}

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    await kv.set<CookieKVValue>(`cookie:${key}`, data, {
      // unstorage 通用 ttl（秒）。cloudflare-kv-binding driver 会自动转换为 expirationTtl；
      // upstash driver 只识别 ttl；memory/fs driver 忽略。
      ttl: getExpirationTtl(data.expiresAt),
    });
    return true;
  } catch (err) {
    console.error('kv.set call failed:', err);
    return false;
  }
}

export async function getMpCookie(key: CookieKVKey): Promise<CookieKVValue | null> {
  const kv = useStorage('kv');
  return await kv.get<CookieKVValue>(`cookie:${key}`);
}
