# UI 验收演示页（真实浏览器）

jsdom 看不出布局、悬浮定位和滚动。这页把三处容易回退的界面放在一起，用与主应用同一套插件 / 别名构建，在真实浏览器里核对：

- 状态栏：配置视图下「书库 / 处理」与「进入处理界面 →」合成一个分组（标签页只有两个，右侧是视图跳转按钮）
- 云端缓存卡片：成功色、标签 / 数值两列对齐、主操作在标题行、费用为 0 时没有游离的 `0`；下方操作行「获取章节 / 配置」在左、「清除缓存」在右
- 书卡悬浮卡：完整 metadata（简介不截断、分类全显示），内容超过可用高度时卡内纵向滚动

```bash
pnpm exec vite build --config tests/tour/uiDemo/vite.config.ts
node tests/tour/richDemo/serve.mjs tmp/ui-demo-dist 5199
```

打开 `http://localhost:5199/`，查询参数：`theme=dark`、`cost=1`（有费用）、`partial=1`（缓存不完整）。
悬浮卡的滚动要把视口压矮（如 900×300）后再触发一次 `resize`，Radix 才会按可用高度重新算 `max-height`。按端口停服务，不要按进程名杀。
