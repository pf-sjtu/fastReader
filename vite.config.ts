import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import yaml from '@rollup/plugin-yaml'

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
  plugins: [react(), tailwindcss(), yaml()],
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
            pkg === "@google/generative-ai" ||
            pkg.startsWith("@ai-sdk/") ||
            pkg.includes("openrouter") ||
            pkg === "zod"
          )
            return "ai"
        },
      },
    },
  },
  server: {
    proxy: {
      '/webdav': {
        target: 'https://dav.jianguoyun.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/webdav/, '/dav'),
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Sending Request to the Target (webdav):', req.method, req.url);
            // 确保认证头被正确转发
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization);
            }
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Received Response from the Target (webdav):', proxyRes.statusCode, req.url);
            // 设置CORS头，允许跨域访问
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
            proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Content-Length, X-Requested-With';
          });
        }
      },
      '/dav': {
        target: 'https://dav.jianguoyun.com',
        changeOrigin: true,
        secure: true,
        // 不要重写路径，直接转发
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Sending Request to the Target (dav):', req.method, req.url);
            // 确保认证头被正确转发
            if (req.headers.authorization) {
              proxyReq.setHeader('Authorization', req.headers.authorization);
            }
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Received Response from the Target (dav):', proxyRes.statusCode, req.url);
            // 设置CORS头，允许跨域访问
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
            proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Content-Length, X-Requested-With';
          });
        }
      }
    }
  },
  publicDir: 'public',
})
