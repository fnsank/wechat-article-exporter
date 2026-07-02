<script setup lang="ts">
import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridOptions,
  GridReadyEvent,
  ICellRendererParams,
  SelectionChangedEvent,
  ValueGetterParams,
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { defu } from 'defu';
import type { PreviewArticle } from '#components';
import { formatTimeStamp } from '#shared/utils/helpers';
import { request } from '#shared/utils/request';
import GridArticleActions from '~/components/grid/ArticleActions.vue';
import GridCoverTooltip from '~/components/grid/CoverTooltip.vue';
import GridStatusBar from '~/components/grid/StatusBar.vue';
import toastFactory from '~/composables/toast';
import { websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
import { articleDeleted, updateArticleStatus } from '~/store/v2/article';
import { type Metadata } from '~/store/v2/metadata';
import type { Preferences } from '~/types/preferences';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

useHead({
  title: `文章搜索 | ${websiteName}`,
});

const toast = toastFactory();

// -------- 数据模型 --------

/**
 * 服务端返回的原始 article shape（跟 /api/public/v1/search-articles 一致）。
 * link 已经是解析后的真实 mp.weixin.qq.com/s?... URL（服务端在同 session 里做的
 * 解析），解析失败时为 null。
 */
interface ApiArticle {
  title: string;
  abstract: string;
  cover_url: string;
  sogou_url: string;
  link: string | null;
  fakeid: string | null;
  sn: string | null;
  account_nickname: string;
  create_time: number | null;
}

interface SearchArticle {
  // 展示用
  title: string;
  digest: string; // = abstract
  cover: string; // = cover_url
  author_name: string; // = account_nickname
  create_time: number | null;

  // 链接 & 标识
  link: string; // 优先 mp URL，解析失败时 fallback 到 sogou_url，保证访问原文能用
  mp_link: string | null; // 严格意义的真实 mp URL（用于抓取/导出/预览的严格判断）
  sogou_url: string;
  fakeid: string;
  aid: string; // = sn

  // 下载状态（跟文章下载页保持一致的字段命名）
  contentDownload: boolean;
  commentDownload: boolean;
  _status?: string;
  is_deleted?: boolean;

  // metadata 抓下来后填
  readNum?: number;
  oldLikeNum?: number;
  shareNum?: number;
  likeNum?: number;
  commentNum?: number;
}

// -------- 搜索条件 --------

const keyword = ref('');
const timeRange = ref<'all' | '7d' | '30d' | '90d' | 'custom'>('all');
const customBegin = ref('');
const customEnd = ref('');
const page = ref(1);

const timeRangeOptions = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
  { value: 'custom', label: '自定义' },
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
      const f: { begin_time?: number; end_time?: number } = {};
      if (customBegin.value) f.begin_time = Math.floor(new Date(customBegin.value).getTime() / 1000);
      if (customEnd.value) f.end_time = Math.floor(new Date(customEnd.value).getTime() / 1000);
      return f;
    }
    default:
      return {};
  }
}

// -------- 表格 --------

let globalRowData: SearchArticle[] = [];
const gridApi = shallowRef<GridApi | null>(null);

const columnDefs = ref<ColDef[]>([
  {
    headerName: '标题',
    field: 'title',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'title',
    minWidth: 260,
  },
  {
    headerName: '封面',
    field: 'cover',
    sortable: false,
    filter: false,
    cellRenderer: (params: ICellRendererParams) =>
      params.value ? `<img alt="" src="${params.value}" style="height: 40px; width: 40px; object-fit: cover;" />` : '',
    tooltipField: 'cover',
    tooltipComponent: GridCoverTooltip,
    minWidth: 80,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '摘要',
    field: 'digest',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'digest',
    minWidth: 260,
  },
  {
    headerName: '公众号',
    field: 'author_name',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 150,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '发布时间',
    field: 'create_time',
    valueFormatter: p => (p.value ? formatTimeStamp(p.value) : ''),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (p: ValueGetterParams) => (p.data.create_time ? new Date(p.data.create_time * 1000) : null),
    minWidth: 180,
    cellClass: 'flex justify-center items-center font-mono',
    sort: 'desc',
  },
  {
    headerName: '解析',
    field: 'mp_link',
    cellDataType: 'boolean',
    valueGetter: p => !!p.data.mp_link,
    cellRenderer: (p: ICellRendererParams) =>
      p.value
        ? '<span style="color: #16a34a;">✓ 已解析</span>'
        : '<span style="color: #dc2626;" title="Sogou 反爬阻挡，抓取/导出不可用">✗ 未解析</span>',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已解析', '未解析'),
    minWidth: 100,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '内容已下载',
    field: 'contentDownload',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已下载', '未下载'),
    minWidth: 130,
    cellClass: 'flex justify-center items-center',
  },
  {
    headerName: '留言已下载',
    field: 'commentDownload',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已下载', '未下载'),
    minWidth: 130,
    cellClass: 'flex justify-center items-center',
    initialHide: true,
  },
  {
    headerName: '阅读',
    field: 'readNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '点赞',
    field: 'oldLikeNum',
    cellDataType: 'number',
    filter: 'agNumberColumnFilter',
    minWidth: 100,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    headerName: '操作',
    field: 'link',
    sortable: false,
    filter: false,
    cellRenderer: GridArticleActions,
    cellRendererParams: {
      onPreview: (params: ICellRendererParams) => preview(params.data),
      onGotoLink: (params: ICellRendererParams) => window.open(params.data.link, '_blank'),
    },
    maxWidth: 100,
    pinned: 'right',
    cellClass: 'flex justify-center items-center',
  },
]);

const gridOptions: GridOptions = defu(
  {
    // 用 sogou_url 做行 ID（每条搜索结果的 sogou 跳转链是唯一的）
    getRowId: (params: GetRowIdParams) => params.data.sogou_url,
    statusBar: {
      statusPanels: [{ statusPanel: GridStatusBar, align: 'left' }],
    },
  },
  sharedGridOptions
);

function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;
  restoreColumnState();
}

function saveColumnState() {
  const state = gridApi.value?.getColumnState();
  localStorage.setItem('agGridColumnState-search', JSON.stringify(state));
}
function restoreColumnState() {
  const stateStr = localStorage.getItem('agGridColumnState-search');
  if (stateStr) {
    try {
      gridApi.value?.applyColumnState({ state: JSON.parse(stateStr), applyOrder: true });
    } catch {}
  }
}
function onColumnStateChange() {
  if (gridApi.value) saveColumnState();
}

// -------- 选择 --------

const selectedArticles = shallowRef<SearchArticle[]>([]);
function onSelectionChanged(evt: SelectionChangedEvent) {
  selectedArticles.value = (evt.selectedNodes || []).map(node => node.data);
}

const resolvedSelectedUrls = computed(() =>
  selectedArticles.value.map(a => a.mp_link).filter((u): u is string => !!u)
);

// -------- 搜索 --------

interface SearchResponse {
  code: number;
  err_msg?: string;
  articles?: ApiArticle[];
  total?: number;
  total_before_filter?: number;
  resolved?: number;
  page?: number;
  elapsedMs?: number;
  reason?: string;
}

const searching = ref(false);
const searchError = ref('');
const hasSearched = ref(false);
const searchStats = ref({ total: 0, resolved: 0, elapsedMs: 0 });

async function doSearch(newPage = 1) {
  const q = keyword.value.trim();
  if (!q) return;
  searching.value = true;
  searchError.value = '';
  hasSearched.value = true;
  page.value = newPage;

  const filter = computeTimeFilter();
  const query: Record<string, string> = { q, page: String(newPage) };
  if (filter.begin_time) query.begin_time = String(filter.begin_time);
  if (filter.end_time) query.end_time = String(filter.end_time);

  try {
    const resp = await request<SearchResponse>('/api/public/v1/search-articles', { query });
    if (resp.code !== 0) {
      searchError.value = resp.err_msg || '搜索失败';
      globalRowData = [];
      gridApi.value?.setGridOption('rowData', []);
      return;
    }
    const rows: SearchArticle[] = (resp.articles || []).map(a => ({
      title: a.title,
      digest: a.abstract,
      cover: a.cover_url,
      author_name: a.account_nickname,
      create_time: a.create_time,
      // 优先用真实 mp URL，解析失败时 fallback 到 sogou_url 保证访问原文按钮不废
      link: a.link || a.sogou_url,
      mp_link: a.link,
      sogou_url: a.sogou_url,
      fakeid: a.fakeid || '',
      aid: a.sn || '',
      contentDownload: false,
      commentDownload: false,
    }));

    globalRowData = rows;
    gridApi.value?.setGridOption('rowData', rows);
    searchStats.value = {
      total: resp.total || 0,
      resolved: resp.resolved || 0,
      elapsedMs: resp.elapsedMs || 0,
    };
  } catch (e: any) {
    searchError.value = e?.statusMessage || e?.message || '搜索失败';
  } finally {
    searching.value = false;
  }
}

// -------- 预览 & 复制 & 抓取 & 导出 --------

const previewArticleRef = ref<typeof PreviewArticle | null>(null);
function preview(article: SearchArticle) {
  previewArticleRef.value!.open(article);
}

const copied = ref(false);
function copySelectedLinks() {
  const links = selectedArticles.value.map(a => a.mp_link || a.sogou_url).join('\n');
  if (!links) return;
  navigator.clipboard.writeText(links);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1000);
}

const preferences = usePreferences();

function updateRowByLink(url: string, patch: Partial<SearchArticle>) {
  const article = globalRowData.find(a => a.mp_link === url || a.link === url);
  if (!article) return;
  Object.assign(article, patch);
  const node = gridApi.value?.getRowNode(article.sogou_url);
  if (node) node.updateData(article);
}

const {
  loading: downloadBtnLoading,
  completed_count: downloadCompletedCount,
  total_count: downloadTotalCount,
  download,
  stop: stopDownload,
} = useDownloader({
  onContent(url: string) {
    updateRowByLink(url, { contentDownload: true, _status: '正常', is_deleted: false });
    updateArticleStatus(url, '正常');
    articleDeleted(url, false);
  },
  onStatusChange(url: string, status: string) {
    updateRowByLink(url, { _status: status });
    updateArticleStatus(url, status);
  },
  onDelete(url: string) {
    updateRowByLink(url, { is_deleted: true, _status: '已删除' });
    updateArticleStatus(url, '已删除');
    articleDeleted(url);
  },
  onMetadata(url: string, metadata: Metadata) {
    const patch: Partial<SearchArticle> = {
      readNum: metadata.readNum,
      oldLikeNum: metadata.oldLikeNum,
      shareNum: metadata.shareNum,
      likeNum: metadata.likeNum,
      commentNum: metadata.commentNum,
    };
    if ((preferences.value as unknown as Preferences).downloadConfig.metadataOverrideContent) {
      patch.contentDownload = true;
      patch._status = '正常';
      patch.is_deleted = false;
      updateArticleStatus(url, '正常');
      articleDeleted(url, false);
    }
    updateRowByLink(url, patch);
  },
  onComment(url: string) {
    updateRowByLink(url, { commentDownload: true });
  },
});

const {
  loading: exportBtnLoading,
  phase: exportPhase,
  completed_count: exportCompletedCount,
  total_count: exportTotalCount,
  exportFile,
} = useExporter();

function fireDownload(type: 'html' | 'metadata' | 'comment') {
  const urls = resolvedSelectedUrls.value;
  if (urls.length === 0) {
    toast.error('无可用链接', '所选行都未解析出真实 mp 链接，无法抓取');
    return;
  }
  if (urls.length < selectedArticles.value.length) {
    toast.warning('部分行跳过', `${urls.length}/${selectedArticles.value.length} 条已解析可用`);
  }
  download(type, urls);
}

function fireExport(format: 'excel' | 'json' | 'html' | 'text' | 'markdown') {
  const urls = resolvedSelectedUrls.value;
  if (urls.length === 0) {
    toast.error('无可用链接', '所选行都未解析出真实 mp 链接，无法导出');
    return;
  }
  if (urls.length < selectedArticles.value.length) {
    toast.warning('部分行跳过', `${urls.length}/${selectedArticles.value.length} 条已解析可用`);
  }
  exportFile(format, urls);
}

// -------- 分页 --------
function goPage(delta: number) {
  const target = page.value + delta;
  if (target < 1) return;
  doSearch(target);
}
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">文章搜索</h1>
    </Teleport>

    <div class="flex flex-col h-full divide-y divide-gray-200">
      <!-- 顶部搜索栏 + 操作区 -->
      <header class="flex flex-col gap-2 px-3 py-2">
        <div class="flex items-center gap-2 flex-wrap">
          <UInput
            v-model="keyword"
            placeholder="输入关键词搜索"
            class="w-72"
            icon="i-lucide:search"
            @keydown.enter="doSearch(1)"
          />
          <USelectMenu
            v-model="timeRange"
            :options="timeRangeOptions"
            value-attribute="value"
            option-attribute="label"
            class="w-32"
          />
          <template v-if="timeRange === 'custom'">
            <input type="date" v-model="customBegin" class="border rounded px-2 py-1 text-sm" />
            <span class="text-slate-400">到</span>
            <input type="date" v-model="customEnd" class="border rounded px-2 py-1 text-sm" />
          </template>

          <UButton color="blue" :loading="searching" :disabled="!keyword.trim()" @click="doSearch(1)">搜索</UButton>

          <div class="flex-1"></div>

          <UButton
            color="gray"
            variant="outline"
            :disabled="page <= 1 || searching"
            icon="i-lucide:chevron-left"
            @click="goPage(-1)"
          />
          <span class="text-sm text-slate-500 min-w-[3rem] text-center">第 {{ page }} 页</span>
          <UButton
            color="gray"
            variant="outline"
            :disabled="globalRowData.length === 0 || searching"
            trailing-icon="i-lucide:chevron-right"
            @click="goPage(1)"
          />
        </div>

        <div class="flex items-center gap-2">
          <UButton v-if="downloadBtnLoading" color="black" @click="stopDownload">停止</UButton>
          <ButtonGroup
            :items="[
              { label: '文章内容', event: 'download-article-html' },
              { label: '阅读量 (需要Credential)', event: 'download-article-metadata' },
              { label: '留言内容 (需要Credential)', event: 'download-article-comment' },
            ]"
            @download-article-html="fireDownload('html')"
            @download-article-metadata="fireDownload('metadata')"
            @download-article-comment="fireDownload('comment')"
          >
            <UButton
              :loading="downloadBtnLoading"
              :disabled="selectedArticles.length === 0"
              color="white"
              class="font-mono"
              :label="downloadBtnLoading ? `抓取中 ${downloadCompletedCount}/${downloadTotalCount}` : '抓取'"
              trailing-icon="i-heroicons-chevron-down-20-solid"
            />
          </ButtonGroup>

          <ButtonGroup
            :items="[
              { label: 'Excel', event: 'export-article-excel' },
              { label: 'JSON', event: 'export-article-json' },
              { label: 'HTML', event: 'export-article-html' },
              { label: 'Txt', event: 'export-article-text' },
              { label: 'Markdown', event: 'export-article-markdown' },
            ]"
            @export-article-excel="fireExport('excel')"
            @export-article-json="fireExport('json')"
            @export-article-html="fireExport('html')"
            @export-article-text="fireExport('text')"
            @export-article-markdown="fireExport('markdown')"
          >
            <UButton
              :loading="exportBtnLoading"
              :disabled="selectedArticles.length === 0"
              color="white"
              class="font-mono"
              :label="exportBtnLoading ? `${exportPhase} ${exportCompletedCount}/${exportTotalCount}` : '导出'"
              trailing-icon="i-heroicons-chevron-down-20-solid"
            />
          </ButtonGroup>

          <UButton
            :disabled="selectedArticles.length === 0"
            :icon="copied ? 'i-lucide:check' : 'i-heroicons-link-16-solid'"
            :label="copied ? '已复制' : '复制链接'"
            :color="copied ? 'green' : 'blue'"
            @click="copySelectedLinks"
          />

          <div v-if="hasSearched && !searching && !searchError" class="text-xs text-slate-500 ml-auto">
            {{ searchStats.total }} 条 · {{ searchStats.resolved }} 已解析 · {{ searchStats.elapsedMs }}ms
          </div>
        </div>

        <div v-if="searchError" class="text-sm text-rose-500">{{ searchError }}</div>
      </header>

      <ag-grid-vue
        style="width: 100%; height: 100%"
        :loading="searching"
        :rowData="globalRowData"
        :columnDefs="columnDefs"
        :gridOptions="gridOptions"
        @grid-ready="onGridReady"
        @column-moved="onColumnStateChange"
        @column-visible="onColumnStateChange"
        @column-pinned="onColumnStateChange"
        @column-resized="onColumnStateChange"
        @selection-changed="onSelectionChanged"
      ></ag-grid-vue>
    </div>

    <PreviewArticle ref="previewArticleRef" />
  </div>
</template>
