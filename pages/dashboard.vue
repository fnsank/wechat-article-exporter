<template>
  <div v-if="authReady" class="flex">
    <SideBar />

    <div class="flex flex-col flex-1 overflow-hidden h-screen">
      <div
        class="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-6 dark:border-slate-600 px-6"
      >
        <div id="title"></div>
        <GlobalActions />
      </div>

      <div class="flex-1 overflow-hidden">
        <NuxtPage />
      </div>
    </div>
  </div>
  <div v-else class="flex h-screen w-screen items-center justify-center text-slate-500">
    Checking admin session...
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { request } from '#shared/utils/request';
import GlobalActions from '~/components/dashboard/Actions.vue';
import SideBar from '~/components/dashboard/SideBar.vue';
import type { Preferences } from '~/types/preferences';

type CurrentSession = {
  nickname: string;
  avatar: string;
  expiresAt: string;
  expired: boolean;
};

const authReady = ref(false);
const loginAccount = useLoginAccount();
const preferences = usePreferences() as unknown as Ref<Preferences>;
const { registerHooksOnce, hydrateFromServer } = useAccountsSync();
const wechatKeepalive = useWechatKeepalive();

// 尽早注册 Dexie hook，让所有账号变更（用户在 dashboard 之外触发的也算）都能触发同步
registerHooksOnce();

const stopPreferencesWatch = ref<(() => void) | null>(null);

async function hydrateAccounts() {
  try {
    await hydrateFromServer();
  } catch (e) {
    // 网络/权限异常时静默降级，本地数据仍可用
  }
}

async function hydratePreferences() {
  try {
    const resp = await request<{ code: number; data: Preferences | null }>('/api/admin/preferences');
    if (resp.data) {
      // 服务端为准，合并到本地（保证类型完整字段）
      preferences.value = { ...preferences.value, ...resp.data };
    } else {
      // 服务端无记录，把本地当前状态推上去作为初始
      await request('/api/admin/preferences', { method: 'PUT', body: preferences.value });
    }
  } catch (e) {
    // 网络/权限异常时，静默降级为本地 localStorage
  }

  // hydration 完成后再开启 watch，避免上面赋值触发一次多余的 PUT
  const savePreferences = useDebounceFn(async (val: Preferences) => {
    try {
      await request('/api/admin/preferences', { method: 'PUT', body: val });
    } catch (e) {
      // 保存失败静默，用户下次修改会再尝试
    }
  }, 500);

  stopPreferencesWatch.value = watch(preferences, val => savePreferences(val), { deep: true });
}

onMounted(async () => {
  const adminKey = localStorage.getItem('wechat-exporter:admin-key');
  if (!adminKey) {
    loginAccount.value = null;
    await navigateTo('/admin');
    return;
  }

  try {
    const resp = await $fetch<{ code: number; data: CurrentSession | null }>('/api/admin/wechat-session', {
      headers: {
        'X-Admin-Key': adminKey,
      },
    });

    // Admin Key 有效则放行 dashboard；微信会话是否存在只影响 loginAccount，
    // 未扫码/已过期时由 BottomPanel 提示扫码，不再踢回 /admin
    if (resp.data && !resp.data.expired) {
      loginAccount.value = {
        nickname: resp.data.nickname,
        avatar: resp.data.avatar,
        expires: resp.data.expiresAt,
      };
    } else {
      loginAccount.value = null;
    }
    authReady.value = true;
    await hydratePreferences();
    await hydrateAccounts();
    wechatKeepalive.start();
  } catch (e: any) {
    // 只有 Admin Key 无效（401）才回登录页；其他错误保持在 dashboard 以便用户看到
    if (e?.statusCode === 401) {
      localStorage.removeItem('wechat-exporter:admin-key');
      loginAccount.value = null;
      await navigateTo('/admin');
    } else {
      loginAccount.value = null;
      authReady.value = true;
    }
  }
});

onUnmounted(() => {
  stopPreferencesWatch.value?.();
  wechatKeepalive.stop();
});
</script>
