<script setup lang="ts">
type CurrentSession = {
  authKey: string;
  nickname: string;
  avatar: string;
  expiresAt: string;
  expired: boolean;
};

type LoginSession = {
  id: string;
  expiresAt: string;
};

const adminKey = ref('');
const currentSession = ref<CurrentSession | null>(null);
const loginSession = ref<LoginSession | null>(null);
const qrcodeUrl = ref('');
const status = ref('');
const error = ref('');
const loading = ref(false);
const pollingTimer = ref<number | null>(null);

onMounted(() => {
  adminKey.value = localStorage.getItem('wechat-exporter:admin-key') || '';
  if (adminKey.value) {
    refreshSession();
  }
});

onUnmounted(() => {
  stopPolling();
  revokeQrcodeUrl();
});

const headers = computed(() => ({
  'X-Admin-Key': adminKey.value,
}));

function saveAdminKey() {
  localStorage.setItem('wechat-exporter:admin-key', adminKey.value);
  refreshSession();
}

function revokeQrcodeUrl() {
  if (qrcodeUrl.value) {
    URL.revokeObjectURL(qrcodeUrl.value);
    qrcodeUrl.value = '';
  }
}

function stopPolling() {
  if (pollingTimer.value) {
    window.clearTimeout(pollingTimer.value);
    pollingTimer.value = null;
  }
}

async function requestAdmin<T>(url: string, options: any = {}): Promise<T> {
  return await $fetch<T>(url, {
    ...options,
    headers: {
      ...headers.value,
      ...(options.headers || {}),
    },
  });
}

async function refreshSession() {
  if (!adminKey.value) return;
  error.value = '';
  try {
    const resp = await requestAdmin<{ code: number; data: CurrentSession | null }>('/api/admin/wechat-session');
    currentSession.value = resp.data;
    if (resp.data && !resp.data.expired) {
      localStorage.setItem(
        'login',
        JSON.stringify({
          nickname: resp.data.nickname,
          avatar: resp.data.avatar,
          expires: resp.data.expiresAt,
        })
      );
    } else {
      localStorage.removeItem('login');
    }
  } catch (e: any) {
    currentSession.value = null;
    localStorage.removeItem('login');
    error.value = e?.statusMessage || e?.message || 'Failed to load session';
  }
}

async function startLogin() {
  if (!adminKey.value) return;
  loading.value = true;
  error.value = '';
  status.value = 'Starting login session';
  stopPolling();
  revokeQrcodeUrl();

  try {
    const resp = await requestAdmin<{ code: number; data: LoginSession }>('/api/admin/wechat-login/session', {
      method: 'POST',
    });
    loginSession.value = resp.data;

    const blob = await $fetch<Blob>(`/api/admin/wechat-login/session/${resp.data.id}/qrcode`, {
      responseType: 'blob',
      headers: headers.value,
    });
    qrcodeUrl.value = URL.createObjectURL(blob);
    status.value = 'Waiting for scan';
    schedulePoll();
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Failed to start login';
  } finally {
    loading.value = false;
  }
}

function schedulePoll() {
  stopPolling();
  pollingTimer.value = window.setTimeout(pollStatus, 2000);
}

async function pollStatus() {
  if (!loginSession.value) return;

  try {
    const resp = await requestAdmin<{ code: number; data: { status: string; raw: any } }>(
      `/api/admin/wechat-login/session/${loginSession.value.id}/status`
    );
    status.value = resp.data.status;

    if (resp.data.status === 'confirmed') {
      await completeLogin();
      return;
    }

    if (['waiting', 'scanned', 'unknown'].includes(resp.data.status)) {
      schedulePoll();
    }
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Failed to poll login status';
  }
}

async function completeLogin() {
  if (!loginSession.value) return;
  loading.value = true;
  error.value = '';
  status.value = 'Completing login';

  try {
    await requestAdmin(`/api/admin/wechat-login/session/${loginSession.value.id}/complete`, {
      method: 'POST',
    });
    status.value = 'Logged in';
    loginSession.value = null;
    revokeQrcodeUrl();
    await refreshSession();
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Failed to complete login';
  } finally {
    loading.value = false;
  }
}

async function clearSession() {
  if (!adminKey.value) return;
  loading.value = true;
  error.value = '';
  try {
    await requestAdmin('/api/admin/wechat-session', {
      method: 'DELETE',
    });
    currentSession.value = null;
    localStorage.removeItem('login');
    status.value = 'Session cleared';
  } catch (e: any) {
    error.value = e?.statusMessage || e?.message || 'Failed to clear session';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen bg-slate-50 text-slate-900">
    <div class="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header class="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 class="text-2xl font-semibold">WeChat Admin</h1>
          <p class="text-sm text-slate-500">Manage the single backend WeChat login used by automation APIs.</p>
        </div>
        <UButton color="gray" variant="soft" @click="refreshSession">Refresh</UButton>
      </header>

      <UAlert v-if="error" color="red" variant="soft" :title="error" />

      <section class="rounded-md border border-slate-200 bg-white p-5">
        <h2 class="mb-4 text-lg font-semibold">Admin Access</h2>
        <div class="flex gap-3">
          <UInput v-model="adminKey" class="flex-1" type="password" placeholder="ADMIN_KEY" />
          <UButton color="blue" :disabled="!adminKey" @click="saveAdminKey">Save</UButton>
        </div>
      </section>

      <section class="rounded-md border border-slate-200 bg-white p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">Current WeChat Session</h2>
            <div v-if="currentSession" class="mt-4 flex items-center gap-4">
              <img v-if="currentSession.avatar" :src="currentSession.avatar" class="size-14 rounded-full border" />
              <div>
                <p class="font-medium">{{ currentSession.nickname }}</p>
                <p class="text-sm text-slate-500">Expires: {{ new Date(currentSession.expiresAt).toLocaleString() }}</p>
                <p class="text-sm" :class="currentSession.expired ? 'text-rose-600' : 'text-green-600'">
                  {{ currentSession.expired ? 'Expired' : 'Available' }}
                </p>
              </div>
            </div>
            <p v-else class="mt-4 text-sm text-slate-500">No backend WeChat session is stored.</p>
          </div>
          <div class="flex gap-2">
            <UButton color="blue" :loading="loading" :disabled="!adminKey" @click="startLogin">Scan Login</UButton>
            <UButton color="red" variant="soft" :disabled="!currentSession || loading" @click="clearSession">
              Clear
            </UButton>
          </div>
        </div>
      </section>

      <section v-if="loginSession || qrcodeUrl || status" class="rounded-md border border-slate-200 bg-white p-5">
        <h2 class="text-lg font-semibold">Login Flow</h2>
        <div class="mt-4 flex flex-wrap items-center gap-6">
          <div class="flex size-72 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
            <img v-if="qrcodeUrl" :src="qrcodeUrl" class="size-64" />
            <UIcon v-else name="i-lucide:loader" class="size-8 animate-spin text-slate-400" />
          </div>
          <div class="space-y-2 text-sm">
            <p><span class="font-medium">Status:</span> {{ status || '-' }}</p>
            <p v-if="loginSession"><span class="font-medium">Login session:</span> {{ loginSession.id }}</p>
            <p v-if="loginSession">
              <span class="font-medium">QR expires:</span> {{ new Date(loginSession.expiresAt).toLocaleString() }}
            </p>
          </div>
        </div>
      </section>

      <section class="rounded-md border border-slate-200 bg-white p-5">
        <h2 class="text-lg font-semibold">Automation Usage</h2>
        <p class="mt-2 text-sm text-slate-600">
          AI clients should call public APIs with <code class="font-mono">X-API-Key</code>. The server will use this
          backend WeChat session automatically.
        </p>
      </section>
    </div>
  </main>
</template>
