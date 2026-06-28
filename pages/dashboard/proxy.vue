<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">{{ pageTitle }}</h1>
    </Teleport>

    <div class="flex flex-col h-full divide-y divide-gray-200">
      <header class="px-4 py-5 sm:px-6">
        <div class="flex justify-between items-center mb-3">
          <h2 class="text-2xl font-semibold">统计信息</h2>

          <p v-if="hasPrivateProxy" class="font-serif font-bold">
            私有代理节点: {{ privateProxyList.length }}，认证: {{ proxyAuthorization ? '已配置' : '未配置' }}
          </p>
          <p v-else class="font-serif font-bold">可用: {{ totalSuccess }}，不可用: {{ totalFailure }}</p>
        </div>

        <div v-if="hasPrivateProxy" class="flex justify-between items-center gap-4">
          <p class="text-green-600 text-sm">
            当前已启用设置页配置的私有代理。下载任务会优先使用这些节点，不再使用公共代理池。
          </p>
          <UButton icon="i-lucide:settings" color="blue" variant="soft" to="/dashboard/settings">修改代理</UButton>
        </div>

        <div v-else class="flex justify-between items-center">
          <p class="text-rose-500 text-sm">
            警告: 公共代理资源有限，请合理使用。若需要抓取大量数据，请搭建自己的私有代理节点。<br />
            若发现某 ip 存在滥用公共代理从而导致官网无法使用，将有可能被封禁。
          </p>
          <p
            class="mt-2 px-3 py-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded-md dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700"
          >
            所有代理额度将在每天早上 8:00 刷新。
          </p>
          <UPopover :popper="{ placement: 'left-start', arrow: true }">
            <UButton
              :icon="hasBlocked ? 'i-lucide:annoyed' : 'i-lucide:smile'"
              variant="link"
              :color="hasBlocked ? 'rose' : 'green'"
            />

            <template #panel>
              <div class="p-4 space-y-3 max-h-80 overflow-y-scroll">
                <div>
                  <p>当前 IP:</p>
                  <code class="font-medium" :class="hasBlocked ? 'text-rose-500' : 'text-green-500'">
                    {{ currentIP }}
                  </code>
                </div>
                <div>
                  <p class="flex justify-between items-center min-w-64">
                    <span>已被封禁 IP:</span>
                    <span class="text-xs text-gray-500">若存在误封，请联系开发者</span>
                  </p>
                  <ul>
                    <li v-for="ip in blockedIPS" :key="ip">
                      <code class="text-rose-500">{{ ip }}</code>
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </UPopover>
        </div>
      </header>

      <div class="flex-1 px-4 py-5 sm:py-6 overflow-y-scroll">
        <div v-if="loading" class="flex justify-center items-center mt-5">
          <Loader :size="28" class="animate-spin text-slate-500" />
        </div>

        <div v-if="hasPrivateProxy" class="flex flex-wrap gap-x-10 gap-y-5">
          <div
            v-for="proxy in privateProxyItems"
            :key="proxy.url"
            class="relative w-full max-w-2xl border p-5 rounded-md hover:shadow"
          >
            <h3 class="text-xl text-gray-600 font-mono mb-3 break-all" :title="proxy.url">节点: {{ proxy.host }}</h3>
            <UMeter :value="0" :max="PRIVATE_PROXY_DAILY_LIMIT" color="orange">
              <template #indicator>
                <div class="flex justify-between items-center text-gray-400">
                  <span>今日请求量</span>
                  <p>
                    <span class="text-base text-green-500 font-semibold font-mono">0%</span>
                    <span class="font-mono text-xs"> (未知/{{ PRIVATE_PROXY_DAILY_LIMIT.toLocaleString('en-US') }}) </span>
                  </p>
                </div>
              </template>
            </UMeter>
            <div class="space-y-2 text-sm text-gray-500">
              <p>
                <span class="font-medium text-gray-600">地址:</span>
                <code class="font-mono break-all ml-2">{{ proxy.url }}</code>
              </p>
              <p>
                <span class="font-medium text-gray-600">状态:</span>
                <span class="text-green-600 font-semibold ml-2">已启用</span>
              </p>
              <p>
                <span class="font-medium text-gray-600">认证:</span>
                <span class="ml-2" :class="proxyAuthorization ? 'text-green-600' : 'text-amber-600'">
                  {{ proxyAuthorization ? '已配置 Authorization' : '未配置 Authorization' }}
                </span>
              </p>
              <p class="text-xs text-slate-400">
                按 Cloudflare Workers Free 默认额度估算，每个节点每日约
                {{ PRIVATE_PROXY_DAILY_LIMIT.toLocaleString('en-US') }} 次请求；当前页面未接入 Cloudflare
                Analytics，实际已用量未知。
              </p>
            </div>

            <div class="flex items-center gap-3 absolute right-5 top-5">
              <div class="size-5">
                <UIcon
                  v-if="copiedProxy === proxy.url"
                  name="i-lucide:check"
                  class="size-5 text-gray-500 hover:text-gray-400 cursor-pointer"
                />
                <UTooltip v-else text="复制节点地址">
                  <UIcon
                    name="i-lucide:copy"
                    class="size-5 text-gray-500 hover:text-gray-400 cursor-pointer"
                    @click="copyPrivateProxy(proxy.url)"
                  />
                </UTooltip>
              </div>
            </div>
          </div>
        </div>

        <ProxyMetrics v-else :data="metricsData" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader } from 'lucide-vue-next';
import { request } from '#shared/utils/request';
import ProxyMetrics from '~/components/ProxyMetrics.vue';
import { websiteName } from '~/config';
import type { Preferences } from '~/types/preferences';
import type { AccountMetric } from '~/types/proxy';

const PRIVATE_PROXY_DAILY_LIMIT = 100_000;

useHead({
  title: `代理 | ${websiteName}`,
});

const preferences = usePreferences() as unknown as Ref<Preferences>;

const privateProxyList = computed(() => {
  return (preferences.value.privateProxyList || []).filter(proxy => proxy.startsWith('http'));
});
const proxyAuthorization = computed(() => preferences.value.privateProxyAuthorization || '');
const hasPrivateProxy = computed(() => privateProxyList.value.length > 0);
const pageTitle = computed(() => (hasPrivateProxy.value ? '私有代理' : '公共代理'));
const privateProxyItems = computed(() =>
  privateProxyList.value.map(url => ({
    url,
    host: getProxyHost(url),
  }))
);

const loading = ref(false);
const metricsData = ref<AccountMetric[]>([]);

const totalSuccess = computed(
  () => metricsData.value.filter(item => item.metric && item.metric.dailyRequests < 100_000).length
);
const totalFailure = computed(
  () => metricsData.value.filter(item => item.metric && item.metric.dailyRequests >= 100_000).length
);

const currentIP = ref('');
const blockedIPS = ref<string[]>([]);
const copiedProxy = ref('');

function getProxyHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function getMetricsData() {
  if (hasPrivateProxy.value) {
    metricsData.value = [];
    return;
  }

  loading.value = true;
  try {
    metricsData.value = await fetch('/api/web/worker/overview-metrics')
      .then(res => res.json())
      .catch(e => {
        throw e;
      });
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
}

async function getPublicProxyStatus() {
  if (hasPrivateProxy.value) {
    currentIP.value = '';
    blockedIPS.value = [];
    return;
  }

  await Promise.all([
    getMetricsData(),
    request('/api/web/misc/current-ip').then(data => {
      currentIP.value = data.ip;
    }),
    request<{ ips: string[] } | string[]>('/api/web/worker/blocked-ip-list').then(data => {
      blockedIPS.value = Array.isArray(data) ? data : data.ips || [];
    }),
  ]);
}

function copyPrivateProxy(url: string) {
  navigator.clipboard.writeText(url);
  copiedProxy.value = url;
  setTimeout(() => {
    copiedProxy.value = '';
  }, 1000);
}

onMounted(getPublicProxyStatus);

watch(hasPrivateProxy, getPublicProxyStatus);

const hasBlocked = computed(() => {
  return blockedIPS.value.includes(currentIP.value);
});
</script>
