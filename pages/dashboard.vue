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
import GlobalActions from '~/components/dashboard/Actions.vue';
import SideBar from '~/components/dashboard/SideBar.vue';

type CurrentSession = {
  nickname: string;
  avatar: string;
  expiresAt: string;
  expired: boolean;
};

const authReady = ref(false);
const loginAccount = useLoginAccount();

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
</script>
