/**
 * 存储已添加的公众号"身份"列表（仅 fakeid + 展示信息），不含各浏览器本地的
 * 同步进度/文章缓存 —— 那些量太大不适合放 KV，且不同浏览器 IndexedDB 缓存
 * 也不一样。多设备访问时靠这份身份列表把账号"重新出现"在列表里，进度由各自
 * 浏览器再增量同步。
 */
export interface AccountRef {
  fakeid: string;
  nickname?: string;
  round_head_img?: string;
}

const ACCOUNTS_KEY = 'accounts:default';

export async function getAccounts(): Promise<AccountRef[]> {
  const kv = useStorage('kv');
  const data = await kv.get<AccountRef[]>(ACCOUNTS_KEY);
  return Array.isArray(data) ? data : [];
}

export async function setAccounts(accounts: AccountRef[]): Promise<void> {
  const kv = useStorage('kv');
  await kv.set<AccountRef[]>(ACCOUNTS_KEY, accounts);
}
