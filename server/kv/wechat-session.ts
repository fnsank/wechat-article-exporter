export interface CurrentWechatSession {
  authKey: string;
  nickname: string;
  avatar: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WechatLoginSession {
  id: string;
  sid: string;
  cookie: string;
  createdAt: string;
  updatedAt: string;
}

const CURRENT_SESSION_KEY = 'wechat:current-session';
const LOGIN_SESSION_PREFIX = 'wechat:login-session:';

export function isCurrentWechatSessionExpired(session: CurrentWechatSession): boolean {
  return Date.parse(session.expiresAt) <= Date.now();
}

export async function setCurrentWechatSession(session: CurrentWechatSession): Promise<void> {
  const kv = useStorage('kv');
  await kv.set<CurrentWechatSession>(CURRENT_SESSION_KEY, session, {
    ttl: Math.max(Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000), 60),
  });
}

export async function getCurrentWechatSession(): Promise<CurrentWechatSession | null> {
  const kv = useStorage('kv');
  return await kv.get<CurrentWechatSession>(CURRENT_SESSION_KEY);
}

export async function clearCurrentWechatSession(): Promise<void> {
  const kv = useStorage('kv');
  await kv.removeItem(CURRENT_SESSION_KEY);
}

export async function updateCurrentWechatSession(authKey: string, expiresAt?: string): Promise<void> {
  const session = await getCurrentWechatSession();
  if (!session || session.authKey !== authKey) {
    return;
  }

  const updatedSession: CurrentWechatSession = {
    ...session,
    expiresAt: expiresAt || session.expiresAt,
    updatedAt: new Date().toISOString(),
  };
  await setCurrentWechatSession(updatedSession);
}

export async function setWechatLoginSession(session: WechatLoginSession): Promise<void> {
  const kv = useStorage('kv');
  await kv.set<WechatLoginSession>(`${LOGIN_SESSION_PREFIX}${session.id}`, session, {
    ttl: 60 * 10,
  });
}

export async function getWechatLoginSession(id: string): Promise<WechatLoginSession | null> {
  const kv = useStorage('kv');
  return await kv.get<WechatLoginSession>(`${LOGIN_SESSION_PREFIX}${id}`);
}

export async function clearWechatLoginSession(id: string): Promise<void> {
  const kv = useStorage('kv');
  await kv.removeItem(`${LOGIN_SESSION_PREFIX}${id}`);
}
