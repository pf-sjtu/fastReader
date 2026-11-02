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
- mermaid：好图渲染为图片（6 种放行图型都验过：graph LR、sequenceDiagram、timeline、mindmap、stateDiagram-v2、quadrantChart）；坏图回退为源码，且 `document.body` 里没有残留 `#dmmd-*` / `#mmd-*` 炸弹图节点
- **mindmap 必须是多分支**：只有一条链的 mindmap 会被渲染器拉成竖排长条（实测 viewBox 135×429，缩放到容器宽后高 2367px），多分支（3 支 × 2 层）才是径向树。指南因此写明「mindmap 至少 3 个分支，单链改用 genui hierarchy 或 graph TD」
- **一个 genui 围栏最多 8 个节点**（`GENUI_LIMITS.nodes`，多出来的会被静默丢掉）：演示页曾把九种组件塞进同一个围栏，第 9 个 `quiz` 从未渲染，而验收记录照样写了「九种组件可见」。现在样本在 `sample.ts` 里按上限拆栏，`sample.test.ts` 守卫「每栏 ≤8 节点、九种不多不少、六种图型齐全」；验收时请**实际点一下测验**（判分与解析出现才算过）
- genui：九种组件（含 hierarchy 缩进树、concept 的定义 / 例 / 反例）的浅色 / 深色主题对比度；测验点选判分
- 坏 genui / 未闭合块：回退为源码 + 提示，正文不受影响
- 章末提问区块的样式

改了 `public/_headers` 要重启服务（规则启动时读一次）；按端口停服务，不要按进程名杀。

## 带完整工作台的端到端走查（不需要后端、不需要密码）

演示页只有渲染组件；要看「真实章节结果页」里三种块，用生产构建 + 静态服务 + Playwright 路由桩：

1. `pnpm build`，`node tests/tour/richDemo/serve.mjs dist 5198`
2. Playwright 里对 `**/api/auth/me`（200）、`**/api/state`（`{initialized:true, sections:{ai:{rev:1,updatedAt,data:{providers:[{id:'p1',name:'stub',type:'openai',baseUrl:'https://stub.test/v1',apiKey:{hasSecret:true},models:[{id:'stub-model',enabled:true,source:'manual'}]}],active:{providerId:'p1',modelId:'stub-model'},defaultTemperature:0.3}}},missing:[]}`）、`**/api/state/**`、`**/api/covers*` 打桩，`**/api/ai**` 返回一份含 mermaid / genui / html 块的 OpenAI 形状 chat completion
3. 上传一个有两个标题的 `.md`，处理模式选「文字总结模式」→「开始处理」，在结果页核对三种块、高度、点击、深浅主题

这条路径发现过单看演示页发现不了的问题（html 块高度回报只增不缩，留下大块空白）。
