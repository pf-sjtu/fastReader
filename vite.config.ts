import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import yaml from '@rollup/plugin-yaml'
import { dropWoff1 } from './config/vite-drop-woff1.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** 取模块路径中最后一个 node_modules 之后的包名（含 scope）；非依赖返回 null */
function packageName(id: string): string | null {
  const marker = "node_modules/"
  const normalized = id.replace(/\\/g, "/")
  const i = normalized.lastIndexOf(marker)
  if (i === -1) return null
  const parts = normalized.slice(i + marker.length).split("/")
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [dropWoff1(), react(), tailwindcss(), yaml()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    // Cloudflare Pages：主包拆分，降低 index 体积与首屏解析时间
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Rollup 的 CJS 互操作 helper 必须独立成块：否则会被分进首个 CJS 依赖（cytoscape）的 chunk，
          // 导致所有首屏 chunk 静态依赖它，cytoscape 的懒加载失效
          if (id.includes("commonjsHelpers") || id.includes("commonjs-dynamic-modules")) return "cjs-helpers"
          const pkg = packageName(id)
          if (!pkg) return
          // 只按「包名」匹配，绝不看完整路径：pnpm 的目录名带 peer 依赖后缀
          // （如 @radix-ui+react-dismissable-layer@…_@types+react-dom@…），宽匹配会把 radix 原语拖进 react-vendor，
          // 造成 react-vendor ↔ radix 循环依赖，线上白屏（Cannot access 'b' before initialization）
          if (pkg === "cytoscape" || pkg.startsWith("cytoscape-")) return "cytoscape"
          if (pkg === "pdfjs-dist") return "pdfjs"
          if (pkg === "mind-elixir") return "mind-elixir"
          if (pkg === "@ssshooter/epubjs") return "epubjs"
          if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") return "react-vendor"
          if (pkg === "i18next" || pkg.startsWith("i18next-") || pkg === "react-i18next") return "i18n"
          if (pkg.startsWith("@radix-ui/")) return "radix"
          if (pkg === "lucide-react") return "icons"
          if (
            pkg === "react-markdown" ||
            pkg.startsWith("remark-") ||
            pkg.startsWith("mdast") ||
            pkg.startsWith("micromark")
          )
            return "markdown"
          if (pkg === "webdav" || pkg === "jszip") return "files"
          if (
            pkg.startsWith("@ai-sdk/") ||
            pkg.includes("openrouter") ||
            pkg === "zod"
          )
            return "ai"
        },
      },
    },
  },
  // 本地开发统一用 `wrangler pages dev`（见 docs/deploy.md）：
  // 共享状态、登录与代理都在 Pages Functions 里，只跑 `vite` 无法工作。
  publicDir: 'public',
})
