import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './config/vite.config'
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
    },
  })
)
