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
import dayjs from 'dayjs';
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
import { db } from '~/store/v2/db';
import { type Metadata } from '~/store/v2/metadata';
import {
  clearSearchResults,
  getCachedSearchResults,
  type SearchResultAsset,
  upsertSearchResults,
} from '~/store/v2/search_result';
import type { Preferences } from '~/types/preferences';
import type { AppMsgExWithFakeID } from '~/types/types';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

const LAST_SEARCH_STATE_KEY = 'search-articles:last-state';

const SINGLE_ARTICLE_FAKEID = 'SINGLE_ARTICLE_FAKEID';

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
const pageSize = ref<number>(10);
const totalPages = ref<number | null>(null);
const totalResults = ref<number | null>(null);

const timeRangeOptions = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
  { value: 'custom', label: '自定义' },
];

const pageSizeOptions = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 30, label: '30 条/页' },
  { value: 50, label: '50 条/页' },
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

const { save: saveColumnStateToKV, restore: restoreColumnStateFromKV } = useGridColumnState('search');

function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;
  restoreColumnStateFromKV(gridApi.value);
  // 表格就绪后，如果 Dexie 里有上次搜索的缓存，恢复到界面
  hydrateFromCache();
}

function onColumnStateChange() {
  saveColumnStateToKV(gridApi.value);
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
  page_size?: number;
  total_pages?: number | null;
  total_results?: number | null;
  elapsedMs?: number;
  reason?: string;
}

const searching = ref(false);
const searchError = ref('');
const hasSearched = ref(false);
const searchStats = ref({ total: 0, resolved: 0, elapsedMs: 0 });

function apiToRow(a: ApiArticle): SearchArticle {
  return {
    title: a.title,
    digest: a.abstract,
    cover: a.cover_url,
    author_name: a.account_nickname,
    create_time: a.create_time,
    link: a.link || a.sogou_url,
    mp_link: a.link,
    sogou_url: a.sogou_url,
    fakeid: a.fakeid || '',
    aid: a.sn || '',
    contentDownload: false,
    commentDownload: false,
  };
}

function persistLastSearchState() {
  try {
    localStorage.setItem(
      LAST_SEARCH_STATE_KEY,
      JSON.stringify({
        keyword: keyword.value,
        timeRange: timeRange.value,
        customBegin: customBegin.value,
        customEnd: customEnd.value,
        page: page.value,
        pageSize: pageSize.value,
        totalPages: totalPages.value,
      })
    );
  } catch {}
}

async function doSearch(newPage = 1) {
  const q = keyword.value.trim();
  if (!q) return;
  searching.value = true;
  searchError.value = '';
  hasSearched.value = true;
  page.value = newPage;

  const filter = computeTimeFilter();
  const query: Record<string, string> = {
    q,
    page: String(newPage),
    page_size: String(pageSize.value),
  };
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
    const rows: SearchArticle[] = (resp.articles || []).map(apiToRow);

    globalRowData = rows;
    gridApi.value?.setGridOption('rowData', rows);
    totalPages.value = resp.total_pages ?? null;
    totalResults.value = resp.total_results ?? null;
    searchStats.value = {
      total: resp.total || 0,
      resolved: resp.resolved || 0,
      elapsedMs: resp.elapsedMs || 0,
    };

    // 持久化结果到 Dexie：新关键词换页时清掉旧缓存，然后写入
    const now = Math.floor(Date.now() / 1000);
    const assets: SearchResultAsset[] = (resp.articles || []).map(a => ({
      sogou_url: a.sogou_url,
      keyword: q,
      page: newPage,
      title: a.title,
      abstract: a.abstract,
      cover_url: a.cover_url,
      link: a.link,
      fakeid: a.fakeid,
      sn: a.sn,
      account_nickname: a.account_nickname,
      create_time: a.create_time,
      updated_at: now,
    }));
    // 新一次翻页/搜索时，先清掉这个 keyword 下的老缓存再写入
    if (newPage === 1) await clearSearchResults(q);
    await upsertSearchResults(assets);

    // 持久化 last search state 到 localStorage，页面刷新后能恢复
    persistLastSearchState();
  } catch (e: any) {
    searchError.value = e?.statusMessage || e?.message || '搜索失败';
  } finally {
    searching.value = false;
  }
}

/**
 * 页面挂载时从 Dexie 恢复上次的搜索结果。localStorage 里存了上次搜索的
 * 参数（keyword、page、pageSize、timeRange 等），Dexie 里存了对应的结果集。
 */
async function hydrateFromCache() {
  let state: Record<string, any> = {};
  try {
    const stored = localStorage.getItem(LAST_SEARCH_STATE_KEY);
    if (stored) state = JSON.parse(stored);
  } catch {}
  if (!state.keyword) return;

  keyword.value = state.keyword;
  if (state.timeRange) timeRange.value = state.timeRange;
  if (state.customBegin) customBegin.value = state.customBegin;
  if (state.customEnd) customEnd.value = state.customEnd;
  if (state.page) page.value = state.page;
  if (state.pageSize) pageSize.value = state.pageSize;
  if (state.totalPages) totalPages.value = state.totalPages;

  const cached = await getCachedSearchResults(state.keyword);
  if (cached.length === 0) return;

  const rows: SearchArticle[] = cached.map(c => ({
    title: c.title,
    digest: c.abstract,
    cover: c.cover_url,
    author_name: c.account_nickname,
    create_time: c.create_time,
    link: c.link || c.sogou_url,
    mp_link: c.link,
    sogou_url: c.sogou_url,
    fakeid: c.fakeid || '',
    aid: c.sn || '',
    contentDownload: false,
    commentDownload: false,
  }));
  globalRowData = rows;
  gridApi.value?.setGridOption('rowData', rows);
  hasSearched.value = true;
  searchStats.value = {
    total: rows.length,
    resolved: rows.filter(r => r.mp_link).length,
    elapsedMs: 0,
  };
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

/**
 * 把搜索结果作为"虚拟"文章记录塞进 Dexie，供后续 useDownloader / useExporter
 * 通过 getArticleByLink 找到。对齐 pages/dashboard/single.vue 里 upsertArticleStub
 * 的做法。
 *
 * Sogou 解析出来的 mp URL 是 signature 式（?src=11&timestamp=...&signature=...），
 * 没有 __biz / mid / sn 参数，因此 fakeid 走 SINGLE_ARTICLE_FAKEID 占位符，
 * 之后如果需要真实 fakeid，可以再跑一次 download('fakeid') 从抓下来的 html 里
 * 提取 biz 填回。
 */
function buildStub(article: SearchArticle, index: number): AppMsgExWithFakeID {
  const now = dayjs().unix();
  // 稳定的 aid：优先用 sogou_url 尾部的 hash（唯一）+ index，保证不冲突
  const hashPart = article.sogou_url.slice(-24).replace(/[^a-zA-Z0-9]/g, '');
  const aid = `${hashPart}_${index}`;
  return {
    fakeid: SINGLE_ARTICLE_FAKEID,
    _status: '',
    aid,
    album_id: '',
    appmsg_album_infos: [],
    appmsgid: now,
    author_name: article.author_name || '',
    ban_flag: 0,
    checking: 0,
    copyright_stat: 0,
    copyright_type: 0,
    cover: article.cover || '',
    cover_img: article.cover || '',
    cover_img_theme_color: undefined,
    create_time: article.create_time || now,
    digest: article.digest || '',
    has_red_packet_cover: 0,
    is_deleted: false,
    is_pay_subscribe: 0,
    item_show_type: 0,
    itemidx: 1,
    link: article.link,
    media_duration: '0:00',
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: article.cover || '',
    pic_cdn_url_3_4: article.cover || '',
    pic_cdn_url_16_9: article.cover || '',
    pic_cdn_url_235_1: article.cover || '',
    title: article.title,
    update_time: article.create_time || now,
    _single: true,
  } as AppMsgExWithFakeID;
}

async function ensureStubsInDexie(articles: SearchArticle[]): Promise<string[]> {
  const validUrls: string[] = [];
  await Promise.all(
    articles.map(async (article, index) => {
      if (!article.mp_link) return;
      const stub = buildStub(article, index);
      await db.article.put(stub, `${stub.fakeid}:${stub.aid}`);
      validUrls.push(article.mp_link);
    })
  );
  return validUrls;
}

async function fireDownload(type: 'html' | 'metadata' | 'comment') {
  if (selectedArticles.value.length === 0) return;
  const urls = await ensureStubsInDexie(selectedArticles.value);
  if (urls.length === 0) {
    toast.error('无可用链接', '所选行都未解析出真实 mp 链接，无法抓取');
    return;
  }
  if (urls.length < selectedArticles.value.length) {
    toast.warning('部分行跳过', `${urls.length}/${selectedArticles.value.length} 条已解析可用`);
  }
  download(type, urls);
}

async function fireExport(format: 'excel' | 'json' | 'html' | 'text' | 'markdown') {
  if (selectedArticles.value.length === 0) return;
  const urls = await ensureStubsInDexie(selectedArticles.value);
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
  if (totalPages.value && target > totalPages.value) return;
  doSearch(target);
}

// 用户改 pageSize 后：如果已经搜过，重新以第 1 页搜一次
watch(pageSize, (nv, ov) => {
  if (nv !== ov && hasSearched.value && keyword.value.trim()) {
    doSearch(1);
  }
});
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

          <USelectMenu
            v-model="pageSize"
            :options="pageSizeOptions"
            value-attribute="value"
            option-attribute="label"
            class="w-28"
          />

          <UButton
            color="gray"
            variant="outline"
            :disabled="page <= 1 || searching"
            icon="i-lucide:chevron-left"
            @click="goPage(-1)"
          />
          <span class="text-sm text-slate-500 min-w-[4.5rem] text-center font-mono">
            {{ page }}<span v-if="totalPages"> / {{ totalPages }}</span>
          </span>
          <UButton
            color="gray"
            variant="outline"
            :disabled="
              searching || globalRowData.length === 0 || (totalPages !== null && page >= totalPages)
            "
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
            <UTooltip
              v-if="totalResults"
              :text="`Sogou 声明共 ${totalResults} 条结果，但未登录用户仅可翻页查看约 ${totalPages || 10} 页 (~${(totalPages || 10) * 10} 条)`"
              :popper="{ placement: 'top' }"
            >
              <span class="ml-2 text-slate-400 underline decoration-dotted">
                Sogou 声明 {{ totalResults.toLocaleString() }} 条
                <UIcon name="i-lucide:info" class="size-3 inline align-baseline" />
              </span>
            </UTooltip>
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
