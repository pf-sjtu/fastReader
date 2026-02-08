# Change: 更新 EPUB TOC 层级语义为精确层级匹配

## Why

当前 `EPUB TOC 模式` 下，`epubTocDepth = n` 的语义是"提取 1..n 级累计目录"，导致选择第 n 级时，列表仍包含第 n-1 级（以及更上级）。这与用户直觉不符，用户期望"选择第 n 级只显示第 n 级目录"。

需要将语义从"累计深度"改为"精确层级"，提升用户体验和可预测性。

## What Changes

- **行为变更**: `epubTocDepth` 从"提取 1..n 级"改为"仅提取第 n 级"
  - depth=1: 仅返回第 1 级目录（depth=0 内部表示）
  - depth=2: 仅返回第 2 级目录（depth=1 内部表示），不含第 1 级
  - depth=3: 仅返回第 3 级目录（depth=2 内部表示），不含第 1、2 级
- **内容策略**: 精确层级模式下，目标层级章节不拼接子级 `subitems` 内容
- **兜底策略**: 当目标层级过滤后为空时，保留现有 fallback 逻辑
- **文案更新**: 更新中英文 i18n 描述，避免用户误解为"越大越累计"

## Impact

- Affected specs: epub-processing
- Affected code:
  - `src/services/epubProcessor.ts` - 核心层级过滤逻辑
  - `src/i18n/locales/zh.json` - 中文文案
  - `src/i18n/locales/en.json` - 英文文案
  - `tests/services/epubProcessor.test.ts` - 回归测试

## Breaking Change

**BREAKING**: `epubTocDepth` 的语义发生变更。 Previously depth=2 would include both level 1 and level 2 chapters. Now it only includes level 2 chapters.
