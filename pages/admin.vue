<script setup lang="ts">
import { websiteName } from '~/config';

definePageMeta({
  layout: false,
});

const adminKey = ref('');
const loading = ref(false);
const error = ref('');

onMounted(() => {
  const saved = localStorage.getItem('wechat-exporter:admin-key');
  if (saved) {
    adminKey.value = saved;
  }
});

async function login() {
  if (!adminKey.value || loading.value) return;
  loading.value = true;
  error.value = '';

  try {
    await $fetch('/api/admin/wechat-session', {
      headers: { 'X-Admin-Key': adminKey.value },
    });
    localStorage.setItem('wechat-exporter:admin-key', adminKey.value);
    await navigateTo('/dashboard/account');
  } catch (e: any) {
    if (e?.statusCode === 401) {
      error.value = 'Admin Key 无效';
    } else {
      error.value = e?.statusMessage || e?.message || '登录失败，请稍后重试';
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div class="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 class="text-center text-xl font-semibold text-slate-800">{{ websiteName }}</h1>
      <p class="mt-1 text-center text-sm text-slate-500">请输入 Admin Key 登录</p>

      <form class="mt-6 space-y-4" @submit.prevent="login">
        <UInput
          v-model="adminKey"
          type="password"
          placeholder="Admin Key"
          size="lg"
          autocomplete="current-password"
          :disabled="loading"
        />
        <UAlert v-if="error" color="red" variant="soft" :description="error" />
        <UButton block color="blue" size="lg" type="submit" :loading="loading" :disabled="!adminKey">登录</UButton>
      </form>
    </div>
  </main>
</template>
