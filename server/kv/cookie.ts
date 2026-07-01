import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
  expiresAt?: string;
}

function getExpirationTtl(expiresAt?: string): number {
  // 最小 TTL：无论微信侧 cookie 声明多短（slave_sid 等常是 2~4 小时），
  // 都在 KV 中至少保留 4 天，避免用户短暂离开回来就要重登。
  // 若微信 cookie 声明的过期时间比 4 天还长，则以微信为准。
  const MIN_TTL_SECONDS = 60 * 60 * 24 * 4;
  if (!expiresAt) {
    return MIN_TTL_SECONDS;
  }
  const seconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  return Math.max(seconds, MIN_TTL_SECONDS);
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
