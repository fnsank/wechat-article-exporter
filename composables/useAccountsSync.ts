import { useDebounceFn } from '@vueuse/core';
import { request } from '#shared/utils/request';
import { db } from '~/store/v2/db';
import { getAllInfo, type MpAccount } from '~/store/v2/info';
import useAccountEventBus from '~/composables/useAccountEventBus';

interface AccountRef {
  fakeid: string;
  nickname?: string;
  round_head_img?: string;
}

let hooksRegistered = false;

async function syncNow() {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem('wechat-exporter:admin-key')) return;
  try {
    const infos = await getAllInfo();
    const refs: AccountRef[] = infos.map(a => ({
      fakeid: a.fakeid,
      nickname: a.nickname,
      round_head_img: a.round_head_img,
    }));
    await request('/api/admin/accounts', { method: 'PUT', body: refs });
  } catch (e) {
    // 静默：失败不影响本地使用，下次变更还会重试
  }
}

const debouncedSync = useDebounceFn(syncNow, 800);

function registerHooksOnce() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  db.info.hook('creating', () => {
    debouncedSync();
  });

  db.info.hook('deleting', () => {
    debouncedSync();
  });

  db.info.hook('updating', mods => {
    // 只在身份字段变化时同步；避免各种计数器（count/articles/update_time）频繁触发
    if (mods && typeof mods === 'object' && ('nickname' in mods || 'round_head_img' in mods)) {
      debouncedSync();
    }
  });
}

/**
 * 从服务端 KV 拉取账号身份列表，同步到本地 Dexie info 表。
 * - 服务端有、本地没有 → 新增（计数器归零，用户可再触发同步）
 * - 服务端有、本地有 → 只更新 nickname / round_head_img，保留本地计数器
 * - 本地有、服务端没有 → 不删除（避免多设备场景意外丢失本地正在处理的账号）
 */
async function hydrateFromServer() {
  const resp = await request<{ code: number; data: AccountRef[] }>('/api/admin/accounts');
  const serverAccounts = Array.isArray(resp.data) ? resp.data : [];

  const localAccounts = await getAllInfo();
  const localMap = new Map(localAccounts.map(a => [a.fakeid, a]));

  const toPut: MpAccount[] = [];
  for (const remote of serverAccounts) {
    if (!remote.fakeid) continue;
    const local = localMap.get(remote.fakeid);
    if (local) {
      const merged: MpAccount = { ...local };
      if (remote.nickname && merged.nickname !== remote.nickname) merged.nickname = remote.nickname;
      if (remote.round_head_img && merged.round_head_img !== remote.round_head_img) {
        merged.round_head_img = remote.round_head_img;
      }
      toPut.push(merged);
    } else {
      const nowSec = Math.round(Date.now() / 1000);
      toPut.push({
        fakeid: remote.fakeid,
        nickname: remote.nickname,
        round_head_img: remote.round_head_img,
        completed: false,
        count: 0,
        articles: 0,
        total_count: 0,
        create_time: nowSec,
        update_time: nowSec,
      });
    }
  }

  if (toPut.length > 0) {
    await db.info.bulkPut(toPut);
    // 通知列表与凭证面板刷新（对每个新加入的 fakeid 触发一次事件）
    const { accountEventBus } = useAccountEventBus();
    const newFakeids = toPut
      .filter(a => !localMap.has(a.fakeid))
      .map(a => a.fakeid);
    for (const fakeid of newFakeids) {
      accountEventBus.emit('account-added', { fakeid });
    }
  }

  // 若服务端为空但本地有账号，推一次初始化
  if (serverAccounts.length === 0 && localAccounts.length > 0) {
    await syncNow();
  }
}

export default function useAccountsSync() {
  return {
    registerHooksOnce,
    hydrateFromServer,
  };
}
