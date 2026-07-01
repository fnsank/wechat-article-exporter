<script setup lang="ts">
import { request } from '#shared/utils/request';
import type { LoginAccount } from '~/types/types';

interface LoginSession {
  id: string;
  expiresAt: string;
}

interface CompleteResponse {
  code: number;
  data: LoginAccount & { authKey: string };
}

interface StatusResponse {
  code: number;
  data: { status: string; raw?: any };
}

const modal = useModal();
const loginAccount = useLoginAccount();

const qrcodeSrc = ref('');
const loading = ref(false);
const msg = ref('');

const checkTimer = ref<number | null>(null);
const loginSession = ref<LoginSession | null>(null);

onMounted(async () => {
  if (!localStorage.getItem('wechat-exporter:admin-key')) {
    modal.close();
    await navigateTo('/admin');
    return;
  }
  await startLogin();
});

onUnmounted(() => {
  stopPolling();
  revokeQrcode();
});

function closeModal() {
  stopPolling();
  revokeQrcode();
  modal.close();
}

function stopPolling() {
  if (checkTimer.value) {
    window.clearTimeout(checkTimer.value);
    checkTimer.value = null;
  }
}

function revokeQrcode() {
  if (qrcodeSrc.value) {
    URL.revokeObjectURL(qrcodeSrc.value);
    qrcodeSrc.value = '';
  }
}

async function startLogin() {
  loading.value = true;
  msg.value = '获取登录二维码';
  revokeQrcode();
  stopPolling();

  try {
    const resp = await request<{ code: number; data: LoginSession }>('/api/admin/wechat-login/session', {
      method: 'POST',
    });
    loginSession.value = resp.data;

    const blob = await request<Blob>(`/api/admin/wechat-login/session/${resp.data.id}/qrcode`, {
      responseType: 'blob',
    });
    qrcodeSrc.value = URL.createObjectURL(blob);
    msg.value = '';
    schedulePoll();
  } catch (e: any) {
    msg.value = e?.statusMessage || e?.message || '获取二维码失败';
  } finally {
    loading.value = false;
  }
}

function schedulePoll() {
  stopPolling();
  if (!modal.isOpen.value) return;
  checkTimer.value = window.setTimeout(pollStatus, 2000);
}

async function pollStatus() {
  if (!loginSession.value) return;

  try {
    const resp = await request<StatusResponse>(`/api/admin/wechat-login/session/${loginSession.value.id}/status`);

    switch (resp.data.status) {
      case 'confirmed':
        msg.value = '已确认，正在登录中';
        await completeLogin();
        return;
      case 'scanned':
        msg.value = '扫码成功，等待确认';
        revokeQrcode();
        schedulePoll();
        return;
      case 'expired':
        msg.value = '二维码已失效，正在刷新';
        await startLogin();
        return;
      case 'unbound_email':
        msg.value = '该账号尚未绑定邮箱';
        schedulePoll();
        return;
      case 'no_account':
        msg.value = '没有可登录账号';
        schedulePoll();
        return;
      case 'failed':
        msg.value = '登录失败，请稍后重试';
        return;
      case 'waiting':
      case 'unknown':
      default:
        schedulePoll();
        return;
    }
  } catch (e: any) {
    msg.value = e?.statusMessage || e?.message || '轮询登录状态失败';
  }
}

async function completeLogin() {
  if (!loginSession.value) return;
  loading.value = true;

  try {
    const resp = await request<CompleteResponse>(
      `/api/admin/wechat-login/session/${loginSession.value.id}/complete`,
      { method: 'POST' }
    );
    const { nickname, avatar, expires } = resp.data;
    loginAccount.value = { nickname, avatar, expires };
    msg.value = '登录成功';
    closeModal();
  } catch (e: any) {
    msg.value = e?.statusMessage || e?.message || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UModal prevent-close>
    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">登录微信公众号</h2>
        <UButton
          square
          variant="link"
          color="gray"
          icon="i-lucide:x"
          class="absolute right-3 top-3"
          @click="closeModal"
        />
      </template>

      <div class="flex flex-col justify-center items-center mx-auto size-80">
        <UIcon v-if="loading" name="i-lucide:loader" :size="28" class="animate-spin text-slate-500" />
        <p v-if="msg" class="text-rose-500">{{ msg }}</p>
        <img v-if="qrcodeSrc" :src="qrcodeSrc" alt="" class="w-full rounded-md" />
      </div>
    </UCard>
  </UModal>
</template>
