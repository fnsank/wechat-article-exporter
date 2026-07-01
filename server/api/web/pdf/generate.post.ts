/**
 * PDF 生成端点。基于 puppeteer + headless Chromium，只能跑在带 Chromium 的
 * 长期运行 Node 环境（如 Docker）里。Cloudflare Workers / Vercel Serverless
 * 都无法启动 Chromium 进程，所以这里始终返回 501。
 *
 * 之前尝试通过 dynamic import 惰性加载 puppeteer 让 CF 构建时不打进 bundle，
 * 但 Rollup 静态字符串仍会追踪其依赖链，wrangler 二次打包会因为 agent-base /
 * basic-ftp / chromium-bidi / cosmiconfig / socks / yargs 等间接依赖使用了
 * 未加 node: 前缀的 Node 内置模块 require 而全部报错。
 *
 * 如需在 Docker 部署里恢复 PDF 导出：从 git 历史里复原本文件与
 * server/utils/puppeteer.ts 即可。
 */
export default defineEventHandler(event => {
  throw createError({
    statusCode: 501,
    statusMessage: '当前部署环境不支持 PDF 导出，请使用带 Chromium 的 Docker 部署',
  });
});
