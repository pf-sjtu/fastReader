import { defineConfig, type ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import yaml from '@rollup/plugin-yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), yaml()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // 浏览器包不引入 Node 代理实现（仅 CLI/Node 路径需要）
      "https-proxy-agent": resolve(__dirname, "src/shims/empty-module.ts"),
      "agent-base": resolve(__dirname, "src/shims/empty-module.ts"),
    },
  },
  build: {
    // Cloudflare Pages：主包拆分，降低 index 体积与首屏解析时间
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("cytoscape")) return "cytoscape"
          if (id.includes("pdfjs-dist")) return "pdfjs"
          if (id.includes("mind-elixir")) return "mind-elixir"
          if (id.includes("@ssshooter/epubjs") || id.includes("epubjs")) return "epubjs"
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("\\react\\"))
            return "react-vendor"
          if (id.includes("i18next")) return "i18n"
          if (id.includes("@radix-ui")) return "radix"
          if (id.includes("lucide-react")) return "icons"
          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("/mdast") ||
            id.includes("micromark")
          )
            return "markdown"
          if (id.includes("webdav") || id.includes("jszip")) return "files"
          if (
            id.includes("@google/generative-ai") ||
            id.includes("@ai-sdk") ||
            id.includes("openrouter") ||
            id.includes("zod")
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
  // 添加静态文件处理配置
  publicDir: 'public',
  // 确保 favicon.ico 请求被正确处理
  configureServer: (server: ViteDevServer) => {
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (req.url === '/favicon.ico') {
        // 重定向到 SVG favicon
        res.statusCode = 302;
        res.setHeader('Location', '/favicon.svg');
        res.end();
        return;
      }
      next();
    });
  }
})
