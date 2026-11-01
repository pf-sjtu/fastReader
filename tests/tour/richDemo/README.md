# 富内容块验收演示页（真实浏览器 + 生产 CSP）

jsdom 测不出 CSP、iframe 沙箱、`postMessage` 握手这类问题（html 块曾因此在线上整个失效）。
这套演示页用与主应用同一套 Vite 插件 / 别名构建，再用 `serve.mjs` 按 `public/_headers` 的规则（含 Cloudflare 的 `! Header` 摘除语法）起静态服务，
在真实浏览器里复现线上响应头。

```bash
pnpm exec vite build --config tests/tour/richDemo/vite.config.ts
node tests/tour/richDemo/serve.mjs tmp/rich-demo-dist 5198
```

然后用浏览器（Playwright MCP 的 Chromium 为准；内置浏览器的 `src` 沙箱 iframe 有无法 postMessage 的已知差异）打开 `http://localhost:5198/`，核对：

- html 块：iframe 高度自适应（不停在 120px、无内部滚动条）；按钮点击有反应；安全探针（外链脚本 / 网络 / 读 Cookie / 嵌套页面）全部被拦
- mermaid：好图渲染为图片；坏图回退为源码，且 `document.body` 里没有残留 `#dmmd-*` / `#mmd-*` 炸弹图节点
- genui：七种组件的浅色 / 深色主题对比度；测验点选判分
- 坏 genui / 未闭合块：回退为源码 + 提示，正文不受影响
- 章末提问区块的样式

改了 `public/_headers` 要重启服务（规则启动时读一次）；按端口停服务，不要按进程名杀。
