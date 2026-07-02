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
import { IMAGE_PROXY, websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
import { articleDeleted, updateArticleStatus } from '~/store/v2/article';
import { getCommentCache } from '~/store/v2/comment';
import { getHtmlCache } from '~/store/v2/html';
import { getMetadataCache, type Metadata } from '~/store/v2/metadata';
import type { Preferences } from '~/types/preferences';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

useHead({
  title: `文章搜索 | ${websiteName}`,
});

const toast = toastFactory();

// -------- 数据模型 --------

interface SearchArticle {
  // sogou 抓下来的原始字段
  redirect_url: string; // sogou /link?url=xxx，用户点也能打开
  title: string;
  digest: string;
  cover: string;
  author_name: string; // 公众号名（sogou 的 all-time-y2 span）
  create_time: number | null;

  // 解析后的真实 URL 与 __biz（fakeid），未解析前为空
  resolved_url: string | null;
  link: string; // = resolved_url || redirect_url，供 preview / copy 使用
  fakeid: string;
  aid: string;

  // 下载状态
  contentDownload: boolean;
  commentDownload: boolean;
  _status?: string;
  is_deleted?: boolean;

  // 阅读量等（抓取 metadata 后填）
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
    getRowId: (params: GetRowIdParams) => params.data.redirect_url,
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

// -------- 搜索 --------

interface SearchResponse {
  code: number;
  err_msg?: string;
  articles?: {
    title: string;
    abstract: string;
    cover_url: string;
    redirect_url: string;
    account_nickname: string;
    account_biz: string | null;
    create_time: number | null;
  }[];
  total?: number;
  total_before_filter?: number;
  page?: number;
  elapsedMs?: number;
  reason?: string;
}

const searching = ref(false);
const searchError = ref('');
const hasSearched = ref(false);
const searchStats = ref({ total: 0, beforeFilter: 0, elapsedMs: 0 });

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
      redirect_url: a.redirect_url,
      title: a.title,
      digest: a.abstract,
      cover: a.cover_url,
      author_name: a.account_nickname,
      create_time: a.create_time,
      resolved_url: null,
      link: a.redirect_url,
      fakeid: '',
      aid: '',
      contentDownload: false,
      commentDownload: false,
    }));

    // 用本地 Dexie 检查是否已下载过（用 redirect_url 作 key 不匹配，等解析后再补）
    globalRowData = rows;
    gridApi.value?.setGridOption('rowData', rows);
    searchStats.value = {
      total: resp.total || 0,
      beforeFilter: resp.total_before_filter || 0,
      elapsedMs: resp.elapsedMs || 0,
    };
  } catch (e: any) {
    searchError.value = e?.statusMessage || e?.message || '搜索失败';
  } finally {
    searching.value = false;
  }
}

// -------- Sogou 链解析 --------

interface ResolveResp {
  code: number;
  results?: { source: string; target: string | null; error?: string }[];
}

/**
 * 批量把 sogou /link?url=xxx 解析成真实 mp.weixin.qq.com/s?... 并更新行数据。
 * 返回成功解析出 mp URL 的文章列表。
 */
async function resolveArticles(articles: SearchArticle[]): Promise<SearchArticle[]> {
  const pending = articles.filter(a => !a.resolved_url);
  if (pending.length === 0) return articles;

  // 每批最多 20 条，超了分批
  const batches: string[][] = [];
  for (let i = 0; i < pending.length; i += 20) {
    batches.push(pending.slice(i, i + 20).map(a => a.redirect_url));
  }
  const map = new Map<string, string>(); // source -> target
  for (const urls of batches) {
    const resp = await request<ResolveResp>('/api/public/v1/resolve-sogou-url', {
      method: 'POST',
      body: { urls },
    });
    if (resp.code === 0 && Array.isArray(resp.results)) {
      for (const r of resp.results) {
        if (r.target) map.set(r.source, r.target);
      }
    }
  }

  const updated: SearchArticle[] = [];
  for (const a of articles) {
    if (a.resolved_url) {
      updated.push(a);
      continue;
    }
    const target = map.get(a.redirect_url);
    if (target) {
      const biz = target.match(/[?&]__biz=([^&]+)/)?.[1] || '';
      const sn = target.match(/[?&]sn=([^&]+)/)?.[1] || '';
      a.resolved_url = target;
      a.link = target;
      a.fakeid = biz;
      a.aid = sn;
      // 更新 grid 里的行
      const node = gridApi.value?.getRowNode(a.redirect_url);
      if (node) node.updateData(a);
      updated.push(a);
    } else {
      updated.push(a);
    }
  }
  return updated;
}

// -------- 预览 & 复制 & 抓取 & 导出 --------

const previewArticleRef = ref<typeof PreviewArticle | null>(null);
function preview(article: SearchArticle) {
  previewArticleRef.value!.open(article);
}

const copied = ref(false);
function copySelectedLinks() {
  const links = selectedArticles.value.map(a => a.link).join('\n');
  if (!links) return;
  navigator.clipboard.writeText(links);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1000);
}

const preferences = usePreferences();

const {
  loading: downloadBtnLoading,
  completed_count: downloadCompletedCount,
  total_count: downloadTotalCount,
  download,
  stop: stopDownload,
} = useDownloader({
  onContent(url: string) {
    const article = globalRowData.find(a => a.link === url);
    if (article) {
      article.contentDownload = true;
      article._status = '正常';
      article.is_deleted = false;
      updateRow(article);
      updateArticleStatus(url, '正常');
      articleDeleted(url, false);
    }
  },
  onStatusChange(url: string, status: string) {
    const article = globalRowData.find(a => a.link === url);
    if (article) {
      article._status = status;
      updateRow(article);
      updateArticleStatus(url, status);
    }
  },
  onDelete(url: string) {
    const article = globalRowData.find(a => a.link === url);
    if (article) {
      article.is_deleted = true;
      article._status = '已删除';
      updateRow(article);
      updateArticleStatus(url, '已删除');
      articleDeleted(url);
    }
  },
  onMetadata(url: string, metadata: Metadata) {
    const article = globalRowData.find(a => a.link === url);
    if (article) {
      article.readNum = metadata.readNum;
      article.oldLikeNum = metadata.oldLikeNum;
      article.shareNum = metadata.shareNum;
      article.likeNum = metadata.likeNum;
      article.commentNum = metadata.commentNum;
      if ((preferences.value as unknown as Preferences).downloadConfig.metadataOverrideContent) {
        article.contentDownload = true;
        article._status = '正常';
        updateArticleStatus(url, '正常');
        article.is_deleted = false;
        articleDeleted(url, false);
      }
      updateRow(article);
    }
  },
  onComment(url: string) {
    const article = globalRowData.find(a => a.link === url);
    if (article) {
      article.commentDownload = true;
      updateRow(article);
    }
  },
});

const {
  loading: exportBtnLoading,
  phase: exportPhase,
  completed_count: exportCompletedCount,
  total_count: exportTotalCount,
  exportFile,
} = useExporter();

function updateRow(article: SearchArticle) {
  const node = gridApi.value?.getRowNode(article.redirect_url);
  if (node) node.updateData(article);
}

const resolving = ref(false);

async function ensureResolvedThen(cb: (urls: string[]) => void) {
  if (selectedArticles.value.length === 0) return;
  resolving.value = true;
  try {
    const resolved = await resolveArticles(selectedArticles.value);
    const urls = resolved.map(a => a.resolved_url || '').filter(u => !!u);
    if (urls.length === 0) {
      toast.error('解析失败', '所选行都无法解析成微信原文链接，可能触发 Sogou 反爬');
      return;
    }
    if (urls.length < selectedArticles.value.length) {
      toast.warning(
        '部分解析失败',
        `${urls.length}/${selectedArticles.value.length} 条成功，其余可能因 Sogou 反爬跳过`
      );
    }
    cb(urls);
  } finally {
    resolving.value = false;
  }
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
            @download-article-html="ensureResolvedThen(urls => download('html', urls))"
            @download-article-metadata="ensureResolvedThen(urls => download('metadata', urls))"
            @download-article-comment="ensureResolvedThen(urls => download('comment', urls))"
          >
            <UButton
              :loading="downloadBtnLoading || resolving"
              :disabled="selectedArticles.length === 0"
              color="white"
              class="font-mono"
              :label="
                downloadBtnLoading
                  ? `抓取中 ${downloadCompletedCount}/${downloadTotalCount}`
                  : resolving
                  ? '解析中...'
                  : '抓取'
              "
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
            @export-article-excel="ensureResolvedThen(urls => exportFile('excel', urls))"
            @export-article-json="ensureResolvedThen(urls => exportFile('json', urls))"
            @export-article-html="ensureResolvedThen(urls => exportFile('html', urls))"
            @export-article-text="ensureResolvedThen(urls => exportFile('text', urls))"
            @export-article-markdown="ensureResolvedThen(urls => exportFile('markdown', urls))"
          >
            <UButton
              :loading="exportBtnLoading || resolving"
              :disabled="selectedArticles.length === 0"
              color="white"
              class="font-mono"
              :label="
                exportBtnLoading
                  ? `${exportPhase} ${exportCompletedCount}/${exportTotalCount}`
                  : resolving
                  ? '解析中...'
                  : '导出'
              "
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
            {{ searchStats.total }} 条 · {{ searchStats.elapsedMs }}ms
            <span v-if="searchStats.beforeFilter > searchStats.total" class="text-slate-400">
              (原始 {{ searchStats.beforeFilter }})
            </span>
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
