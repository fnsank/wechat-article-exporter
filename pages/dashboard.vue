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

    if (!resp.data || resp.data.expired) {
      loginAccount.value = null;
      await navigateTo('/admin');
      return;
    }

    loginAccount.value = {
      nickname: resp.data.nickname,
      avatar: resp.data.avatar,
      expires: resp.data.expiresAt,
    };
    authReady.value = true;
  } catch (e) {
    loginAccount.value = null;
    await navigateTo('/admin');
  }
});
</script>
