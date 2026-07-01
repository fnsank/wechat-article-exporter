import type { ParsedCredential } from '~/types/credential';

const CREDENTIAL_PREFIX = 'wechat:credentials:';

export async function setWechatCredential(credential: ParsedCredential): Promise<void> {
  const kv = useStorage('kv');
  await kv.set<ParsedCredential>(`${CREDENTIAL_PREFIX}${credential.biz}`, credential, {
    ttl: 60 * 60,
  });
}

export async function getWechatCredential(biz: string): Promise<ParsedCredential | null> {
  const kv = useStorage('kv');
  return await kv.get<ParsedCredential>(`${CREDENTIAL_PREFIX}${biz}`);
}

export async function deleteWechatCredential(biz: string): Promise<void> {
  const kv = useStorage('kv');
  await kv.removeItem(`${CREDENTIAL_PREFIX}${biz}`);
}

export async function listWechatCredentials(): Promise<ParsedCredential[]> {
  const kv = useStorage('kv');
  const keys = (await kv.getKeys()).filter(key => key.startsWith(CREDENTIAL_PREFIX));
  const credentials = await Promise.all(keys.map(key => kv.get<ParsedCredential>(key)));
  return credentials.filter(Boolean) as ParsedCredential[];
}
