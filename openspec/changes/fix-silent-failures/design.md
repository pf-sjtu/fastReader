## Context

浏览器 SPA + Node CLI 共用 Gemini provider。失败目前多数 `console.*` 或返回 `{success:false}`，UI 把「已处理」和「成功」混用。

## Goals / Non-Goals

- Goals: 失败对用户可见、对日志可定位；堵住 Gemini 代理递归。
- Non-Goals: 全面换 logger、删死代码、CLI WebDAV、PDF DEBUG 迁移。

## Decisions

- Decision: 代理 agent 缺失时在 `doGenerateContent` 内直接走 SDK，不回调自身。
  Alternatives: 抛错强制失败 — 会破坏「代理不可用则直连」的既有意图。
- Decision: 思维导图失败用 `processed: false`，不新增 `processError` 字段。
  Alternatives: 假 mindMap 占位 — 类型更脏，结果区仍可能误渲染。
- Decision: ErrorBoundary 只展示 `error.message`，不展示 componentStack。

## Risks / Trade-offs

- 导图失败章节在导航里变灰、不可点击 → 比绿勾更诚实。
- ErrorBoundary 可能展示底层英文异常 → 可排障，可接受。

## Migration Plan

无需迁移。回滚即还原上述文件。
