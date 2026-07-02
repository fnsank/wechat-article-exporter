import { db } from './db';

export interface SearchResultAsset {
  // 主键：sogou 跳转链，天然唯一
  sogou_url: string;

  // 关联的搜索关键词（一个关键词对应多条结果；换关键词会覆盖 / 追加）
  keyword: string;

  // 逻辑页号（当前搜索的第几页），用于恢复分页状态
  page: number;

  title: string;
  abstract: string;
  cover_url: string;
  link: string | null;
  fakeid: string | null;
  sn: string | null;
  account_nickname: string;
  create_time: number | null;

  // 缓存写入时间戳（秒），用于清理老数据
  updated_at: number;
}

/**
 * 批量写入某关键词 + 页的搜索结果。同 sogou_url 会覆盖（Dexie put 默认行为）。
 */
export async function upsertSearchResults(items: SearchResultAsset[]): Promise<void> {
  if (items.length === 0) return;
  await db.search_result.bulkPut(items);
}

/**
 * 读取指定关键词下所有已缓存的搜索结果，按 create_time desc 排序。
 */
export async function getCachedSearchResults(keyword: string): Promise<SearchResultAsset[]> {
  const rows = await db.search_result.where('keyword').equals(keyword).toArray();
  return rows.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
}

/**
 * 清除指定关键词的搜索结果缓存。
 */
export async function clearSearchResults(keyword: string): Promise<void> {
  await db.search_result.where('keyword').equals(keyword).delete();
}

/**
 * 清除所有搜索结果缓存。
 */
export async function clearAllSearchResults(): Promise<void> {
  await db.search_result.clear();
}
