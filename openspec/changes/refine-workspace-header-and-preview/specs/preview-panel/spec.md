# preview-panel Specification

## Purpose

约束原文预览面板（`PreviewPanel`，侧栏 `sidebar` 与对照栏 `dock` 两种版式）的表头：固定宽度卡片内的标题与控件永远不得横向溢出到卡片之外。

## ADDED Requirements

### Requirement: 预览卡片表头不得横向溢出

固定宽度的预览卡片 SHALL NOT 让表头内容按 max-content 撑宽自身；标题按省略号收窄，字号 / 全屏 / 关闭控件保持在卡片内。

#### Scenario: 长章节标题 + 一组控件
- **GIVEN** 预览卡片宽 320px（`w-80`），表头左侧是长章节标题、右侧是字号步进 + 全屏 + 关闭
- **WHEN** 渲染表头
- **THEN** 表头行的右边界不超出卡片右内边距
- **AND** 标题以省略号收窄，控件完整可见

#### Scenario: 对照栏版式同样成立
- **GIVEN** 预览面板以 `dock` 版式嵌在对照栏页签内
- **WHEN** 对照栏被拖到最窄
- **THEN** 表头控件仍留在面板内，不压到相邻列

### Requirement: 卡片表头使用单列轨道

`CardHeader` SHALL 使用单列网格轨道（`minmax(0, 1fr)`）作为默认布局，使子项不能按 `max-content` 撑宽固定宽度卡片；只有存在 `CardAction` 时才切换到两列轨道。

#### Scenario: 基础类含单列轨道
- **GIVEN** 任意使用 `CardHeader` 的卡片
- **THEN** `CardHeader` 的基础类包含单列轨道声明（`grid-cols-1`）
- **AND** 含 `data-slot="card-action"` 的卡片仍使用 `1fr auto` 两列
