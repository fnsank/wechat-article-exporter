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
    client: 'hidden',
  },
  nitro: {
    minify: process.env.NODE_ENV === 'production',
    rollupConfig: {
      external: ['puppeteer'],
    },
    storage: {
      kv: {
        driver: process.env.NITRO_KV_DRIVER || 'memory',
        base: process.env.NITRO_KV_BASE,
        // upstash driver 凭据：优先读 Vercel Marketplace 集成注入的 KV_REST_API_* 变量，
        // 回退到 Upstash 原生命名 UPSTASH_REDIS_REST_*
        url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
        // cloudflare-kv-binding driver：读取 CF 上名为 KV 的 Workers KV binding
        binding: 'KV',
      },
    },
    // Nitro 任务系统，用于定义 scheduled task；cloudflare_module preset 会
    // 把 scheduledTasks 自动写入 wrangler.json 的 triggers.crons 配置
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // 每 5 分钟触发一次微信登录心跳，保持 cookie 不被微信过期
      '*/5 * * * *': ['wechat:heartbeat'],
    },
    cloudflare: {
      // 由 nitro 在 build 后自动生成 .output/wrangler.json 并注入 triggers/kv_namespaces
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        name: 'wechat-article-exporter',
        kv_namespaces: [
          {
            binding: 'KV',
            id: process.env.CLOUDFLARE_KV_ID || 'placeholder-set-in-cf-dashboard',
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
