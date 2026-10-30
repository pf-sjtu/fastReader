import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

// @ssshooter/epubjs 的 package.json main 指向不存在的 lib/index.js，
// 需显式解析到可用入口；单元测试在各自文件内 vi.mock 覆盖。
const require = createRequire(import.meta.url)
const epubjsRoot = dirname(require.resolve('@ssshooter/epubjs/package.json'))

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        '@ssshooter/epubjs': resolve(epubjsRoot, 'src/index.js'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      // 渲染 Radix 弹层 / 动态 import 整张流水线依赖图的 UI 用例，在全量并行（多 worker 抢 CPU）时
      // 偶发超过默认 5s；单独跑都在 1–2s 内。放宽到 20s，真卡死的用例仍会失败。
      testTimeout: 20_000,
    },
  })
)
