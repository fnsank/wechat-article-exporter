<script setup lang="ts">
import dayjs from 'dayjs';
import { formatTimeStamp } from '#shared/utils/helpers';
import { request } from '#shared/utils/request';
import { IMAGE_PROXY, websiteName } from '~/config';

useHead({
  title: `文章搜索 | ${websiteName}`,
});

interface SogouArticle {
  title: string;
  abstract: string;
  cover_url: string;
  redirect_url: string;
  account_nickname: string;
  account_biz: string | null;
  create_time: number | null;
}

interface SearchResponse {
  code: number;
  err_msg?: string;
  articles?: SogouArticle[];
  total?: number;
  total_before_filter?: number;
  page?: number;
  elapsedMs?: number;
  reason?: string;
  rate?: { current: number; limit: number };
}

const keyword = ref('');
const timeRange = ref<'all' | '7d' | '30d' | '90d' | 'custom'>('all');
const customBegin = ref<string>('');
const customEnd = ref<string>('');
const page = ref(1);

const loading = ref(false);
const results = ref<SogouArticle[]>([]);
const totalOnPage = ref(0);
const totalBeforeFilter = ref(0);
const elapsedMs = ref(0);
const errorMsg = ref('');
const hasSearched = ref(false);

const timeRangeOptions = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
  { value: 'custom', label: '自定义时间段' },
];

function computeTimeFilter(): { begin_time?: number; end_time?: number } {
  const now = Math.floor(Date.now() / 1000);
  switch (timeRange.value) {
    case '7d':
      return { begin_time: now - 7 * 86400 };
    case '30d':
      return { begin_time: now - 30 * 86400 };
    case '90d':
      return { begin_time: now - 90 * 86400 };
    case 'custom': {
      const filter: { begin_time?: number; end_time?: number } = {};
      if (customBegin.value) filter.begin_time = Math.floor(new Date(customBegin.value).getTime() / 1000);
      if (customEnd.value) filter.end_time = Math.floor(new Date(customEnd.value).getTime() / 1000);
      return filter;
    }
    default:
      return {};
  }
}

async function doSearch(newPage = 1) {
  const q = keyword.value.trim();
  if (!q) return;

  loading.value = true;
  errorMsg.value = '';
  hasSearched.value = true;
  page.value = newPage;

  const filter = computeTimeFilter();
  const query: Record<string, string> = { q, page: String(newPage) };
  if (filter.begin_time) query.begin_time = String(filter.begin_time);
  if (filter.end_time) query.end_time = String(filter.end_time);

  try {
    const resp = await request<SearchResponse>('/api/public/v1/search-articles', { query });
    if (resp.code !== 0) {
      results.value = [];
      totalOnPage.value = 0;
      totalBeforeFilter.value = 0;
      errorMsg.value = resp.err_msg || '搜索失败';
      return;
    }
    results.value = resp.articles || [];
    totalOnPage.value = resp.total || 0;
    totalBeforeFilter.value = resp.total_before_filter || 0;
    elapsedMs.value = resp.elapsedMs || 0;
  } catch (e: any) {
    results.value = [];
    if (e?.statusCode === 429) {
      errorMsg.value = '搜索太频繁，请等 1 分钟后重试';
    } else {
      errorMsg.value = e?.statusMessage || e?.message || '搜索失败';
    }
  } finally {
    loading.value = false;
  }
}

function onKeywordEnter() {
  doSearch(1);
}

function goPage(delta: number) {
  const target = page.value + delta;
  if (target < 1) return;
  doSearch(target);
}

function displayCover(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return IMAGE_PROXY + url;
  return url;
}
</script>

<template>
  <div class="h-full flex flex-col">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">文章搜索</h1>
    </Teleport>

    <!-- 顶部搜索栏 -->
    <div class="border-b border-slate-200 px-6 py-4 flex flex-col gap-3">
      <div class="flex gap-2">
        <UInput
          v-model="keyword"
          placeholder="输入关键词搜索微信公众号文章"
          class="flex-1"
          size="lg"
          icon="i-lucide:search"
          @keydown.enter="onKeywordEnter"
        />
        <USelectMenu
          v-model="timeRange"
          :options="timeRangeOptions"
          value-attribute="value"
          option-attribute="label"
          class="w-40"
          size="lg"
        />
        <UButton color="blue" size="lg" :loading="loading" :disabled="!keyword.trim()" @click="doSearch(1)">
          搜索
        </UButton>
      </div>

      <div v-if="timeRange === 'custom'" class="flex gap-2 items-center text-sm text-slate-600">
        <label>从</label>
        <input type="date" v-model="customBegin" class="border rounded px-2 py-1" />
        <label>到</label>
        <input type="date" v-model="customEnd" class="border rounded px-2 py-1" />
      </div>

      <div class="text-xs text-slate-500 flex items-center gap-3">
        <UIcon name="i-lucide:info" class="size-3.5" />
        <span>
          数据来源 Sogou 微信搜索（<a
            href="https://weixin.sogou.com/"
            target="_blank"
            class="underline"
            >weixin.sogou.com</a
          >）—— 索引有几小时延迟，且可能因反爬机制间歇失败。速率限制：30 次/分钟。
        </span>
      </div>
    </div>

    <!-- 结果区 -->
    <div class="flex-1 overflow-auto px-6 py-4">
      <div v-if="loading" class="text-center py-12 text-slate-500">
        <UIcon name="i-lucide:loader" class="size-8 animate-spin mx-auto" />
        <p class="mt-2 text-sm">搜索中...</p>
      </div>

      <div v-else-if="errorMsg" class="text-center py-12">
        <UIcon name="i-lucide:alert-triangle" class="size-8 text-rose-500 mx-auto" />
        <p class="mt-2 text-rose-500">{{ errorMsg }}</p>
      </div>

      <div v-else-if="hasSearched && results.length === 0" class="text-center py-12 text-slate-500">
        <UIcon name="i-lucide:file-question" class="size-8 mx-auto" />
        <p class="mt-2">没有找到相关文章</p>
        <p v-if="totalBeforeFilter > 0" class="mt-1 text-xs">
          （Sogou 返回了 {{ totalBeforeFilter }} 条，但都被时间过滤器排除）
        </p>
      </div>

      <div v-else-if="results.length > 0" class="space-y-4">
        <div class="text-sm text-slate-500 flex items-center gap-4">
          <span>第 {{ page }} 页 · {{ totalOnPage }} 条结果 · 耗时 {{ elapsedMs }}ms</span>
          <span v-if="totalBeforeFilter > totalOnPage" class="text-slate-400">
            (Sogou 返回 {{ totalBeforeFilter }}，时间过滤后 {{ totalOnPage }})
          </span>
        </div>

        <a
          v-for="(article, i) in results"
          :key="`${page}-${i}-${article.title}`"
          :href="article.redirect_url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex gap-4 p-4 border rounded-lg hover:border-blue-400 hover:shadow-sm transition-all block"
        >
          <img
            v-if="article.cover_url"
            :src="displayCover(article.cover_url)"
            alt=""
            class="w-32 h-24 object-cover rounded flex-shrink-0"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div class="flex-1 min-w-0">
            <h3
              class="font-semibold text-slate-900 line-clamp-2"
              v-html="article.title.replace(/<em>/g, '<em class=\'text-blue-600 not-italic\'>')"
            ></h3>
            <p class="mt-1 text-sm text-slate-600 line-clamp-2">{{ article.abstract }}</p>
            <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
              <span v-if="article.account_nickname" class="flex items-center gap-1">
                <UIcon name="i-lucide:user-round" class="size-3.5" />
                {{ article.account_nickname }}
              </span>
              <span v-if="article.create_time" class="flex items-center gap-1">
                <UIcon name="i-lucide:calendar" class="size-3.5" />
                {{ formatTimeStamp(article.create_time) }}
              </span>
              <span class="flex items-center gap-1 text-blue-500">
                <UIcon name="i-lucide:external-link" class="size-3.5" />
                在新窗口打开
              </span>
            </div>
          </div>
        </a>

        <div class="flex justify-center gap-3 pt-4">
          <UButton
            color="gray"
            variant="outline"
            :disabled="page <= 1 || loading"
            icon="i-lucide:chevron-left"
            @click="goPage(-1)"
          >
            上一页
          </UButton>
          <span class="self-center text-sm text-slate-600">第 {{ page }} 页</span>
          <UButton
            color="gray"
            variant="outline"
            :disabled="results.length === 0 || loading"
            trailing-icon="i-lucide:chevron-right"
            @click="goPage(1)"
          >
            下一页
          </UButton>
        </div>
      </div>

      <div v-else class="text-center py-24 text-slate-400">
        <UIcon name="i-lucide:search" class="size-12 mx-auto opacity-30" />
        <p class="mt-4 text-lg">输入关键词开始搜索</p>
        <p class="mt-1 text-sm">在微信公众号海量文章里检索标题、摘要、公众号名</p>
      </div>
    </div>
  </div>
</template>
