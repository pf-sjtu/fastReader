/**
 * 离线单文件学习包：对外出口。
 *
 * - `buildPack`：`PackData` → 自包含 HTML 字符串（纯函数）
 * - `collect`：界面已拿到的数据 → `PackData`（纯函数）
 * - `captureImages`：mermaid 代码 → 内嵌 data URI 图片（浏览器内用）
 */
export * from './buildPack'
export * from './collect'
export * from './captureImages'
