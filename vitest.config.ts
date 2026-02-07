import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './config/vite.config'
import { resolve } from 'node:path'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      alias: {
        '@ssshooter/epubjs': resolve(__dirname, 'tests/__mocks__/@ssshooter/epubjs.ts'),
      },
    },
  })
)
