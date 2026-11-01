import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import yaml from '@rollup/plugin-yaml'

// UI 演示页专用构建：和主应用同一套插件 / 别名，输出到 tmp/ui-demo-dist
const root = resolve(__dirname, '..', '..', '..')
export default defineConfig({
  root: __dirname,
  publicDir: resolve(root, 'public'),
  plugins: [react(), tailwindcss(), yaml()],
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { fs: { allow: [root] } },
  build: { outDir: resolve(root, 'tmp', 'ui-demo-dist'), emptyOutDir: true },
})
