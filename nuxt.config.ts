// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-10-30',
  devtools: {
    enabled: false,
  },
  modules: ['@vueuse/nuxt', '@nuxt/ui', 'nuxt-monaco-editor', '@sentry/nuxt/module', 'nuxt-umami'],
  ssr: false,
  runtimeConfig: {
    adminKey: process.env.ADMIN_KEY,
    apiKey: process.env.API_KEY,
    public: {
      aggridLicense: process.env.NUXT_AGGRID_LICENSE,
      sentry: {
        dsn: process.env.NUXT_SENTRY_DSN,
      },
    },
    debugMpRequest: false,
  },
  app: {
    head: {
      meta: [
        {
          name: 'referrer',
          content: 'no-referrer',
        },
      ],
      script: [
        {
          src: '/vendors/html-docx-js@0.3.1/html-docx.js',
          defer: true,
        },
      ],
    },
  },
  sourcemap: {
    // CF Workers Builds 内存吃紧，生产构建禁用 sourcemap（sentry 单独上传）
    // 本地/其它 preset 保持 'hidden' 便于调试
    client: process.env.NITRO_PRESET === 'cloudflare_module' ? false : 'hidden',
    server: process.env.NITRO_PRESET === 'cloudflare_module' ? false : true,
  },
  nitro: {
    minify: process.env.NODE_ENV === 'production',
    storage: {
      kv: (() => {
        // CF 环境检测：NITRO_PRESET 有时不会作为 env var 暴露给 process.env，
        // Nitro 自己是通过检查一批 CF 特有的 env var 来自动选 preset。这里我们
        // 走同样的检测，避免用户忘设 NITRO_KV_DRIVER 而回退到易失的 memory driver。
        const preset = (process.env.NITRO_PRESET || '').toLowerCase().replace(/-/g, '_');
        const isCloudflareBuild =
          preset === 'cloudflare_module' ||
          preset === 'cloudflare_pages' ||
          process.env.CF_PAGES === '1' ||
          Boolean(process.env.WORKERS_CI) ||
          Boolean(process.env.CF_WORKER_NAME) ||
          Boolean(process.env.CF_ACCOUNT_ID);

        const chosenDriver =
          process.env.NITRO_KV_DRIVER || (isCloudflareBuild ? 'cloudflare-kv-binding' : 'memory');

        // 构建日志里会打印，方便用户在 CF Workers Builds 日志里定位问题
        console.log('[nuxt.config] storage.kv driver decision:', {
          NITRO_KV_DRIVER: process.env.NITRO_KV_DRIVER || '(unset)',
          NITRO_PRESET: process.env.NITRO_PRESET || '(unset)',
          CF_PAGES: process.env.CF_PAGES || '(unset)',
          WORKERS_CI: process.env.WORKERS_CI || '(unset)',
          CF_WORKER_NAME: process.env.CF_WORKER_NAME || '(unset)',
          CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID ? '(set)' : '(unset)',
          isCloudflareBuild,
          chosenDriver,
        });

        return {
          driver: chosenDriver,
          base: process.env.NITRO_KV_BASE,
          // upstash driver 凭据：优先读 Vercel Marketplace 集成注入的 KV_REST_API_* 变量，
          // 回退到 Upstash 原生命名 UPSTASH_REDIS_REST_*
          url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
          // cloudflare-kv-binding driver：读取 CF 上名为 KV 的 Workers KV binding
          binding: 'KV',
        };
      })(),
    },
    // Nitro 任务系统，用于定义 scheduled task；cloudflare_module preset 会
    // 把 scheduledTasks 自动写入 wrangler.json 的 triggers.crons 配置
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // 每 5 分钟触发一次微信登录心跳，保持 cookie 不被微信过期
      // 名字要跟 server/tasks/wechat-heartbeat.ts 的文件名一致（Nitro 用文件路径做 task 名）
      '*/5 * * * *': ['wechat-heartbeat'],
    },
    cloudflare: {
      // 由 nitro 在 build 后自动生成 .output/wrangler.json 并注入 triggers/kv_namespaces
      deployConfig: true,
      // 不启用 nodeCompat（否则 Nitro 会在构建期用 unenv 打入 fs/path/buffer/crypto 等
      // Node polyfill，rollup rendering chunks 阶段内存直接翻倍导致 OOM）；
      // 改用 CF Workers 的 runtime flag nodejs_compat，运行时按需提供 Node API
      wrangler: {
        name: 'wechat-article-exporter',
        compatibility_flags: ['nodejs_compat'],
        // 让 wrangler deploy 保留在 CF Dashboard 里手动设置的 Runtime Variables /
        // Secrets（默认行为是把远端配置完全同步为本地 wrangler.json 的镜像，
        // 会把 Dashboard 里手动加的变量清掉）
        keep_vars: true,
        kv_namespaces: [
          {
            binding: 'KV',
            // 默认写死当前 CF 项目的 KV Namespace ID。CF Workers Builds 里的
            // "Variables" 是 Worker Runtime 变量，Node build 过程读不到 process.env，
            // 所以之前设了 CLOUDFLARE_KV_ID 也不生效。这里作为默认值，如需切换
            // KV Namespace，可以在 build shell 里设置 CLOUDFLARE_KV_ID env var 覆盖。
            id: process.env.CLOUDFLARE_KV_ID || '3dee57bceca74a7094a8f3f72a74dfca',
          },
        ],
        triggers: {
          crons: ['*/5 * * * *'],
        },
      },
    },
  },
  monacoEditor: {
    locale: 'en',
    componentName: {
      codeEditor: 'MonacoEditor', // 普通编辑器组件名
      diffEditor: 'MonacoDiffEditor', // 差异编辑器组件名
    },
  },

  // https://docs.sentry.io/platforms/javascript/guides/nuxt/manual-setup/
  sentry: {
    org: process.env.NUXT_SENTRY_ORG,
    project: process.env.NUXT_SENTRY_PROJECT,
    authToken: process.env.NUXT_SENTRY_AUTH_TOKEN,
    telemetry: false,
  },

  // https://umami.nuxt.dev/api/configuration
  umami: {
    enabled: true,
    id: process.env.NUXT_UMAMI_ID,
    host: process.env.NUXT_UMAMI_HOST,
    domains: ['down.mptext.top'],
    ignoreLocalhost: true,
    autoTrack: true,
    logErrors: true,
  },
});
