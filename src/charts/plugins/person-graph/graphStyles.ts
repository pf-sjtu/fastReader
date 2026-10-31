import type { ChartThemeColors } from '../../theme'

/** fit 时画布四周留白 */
export const FIT_PADDING = 40

type Ele = { data: (k: string) => number }

/**
 * cytoscape 样式：名字居中写在球上。
 * 联动相关的 class：
 *   colorized  节点按统一实体色/形状着色（data(color/shape/textColor) 由 graphFocus.applyEntityStyle 写入）
 *   hit        本章出现的实体（高亮）；dim：非本章（淡化）；focused：被聚焦的实体
 *   gone       渐进模式下"读到此处还没出现"的节点/边；filtered：被图例的类型过滤隐藏
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStyles(theme: ChartThemeColors): any[] {
  const nodeFill = theme.primary
  const onNodeText = theme.primaryForeground
  const edgeColor = theme.mutedForeground
  const labelBg = theme.card
  const edgeLabelColor = theme.foreground

  return [
    {
      selector: 'node',
      style: {
        // label 已在 toCytoscape 中按宽度拆行，保证落在圆内
        label: 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'background-color': nodeFill,
        'background-opacity': 1,
        color: onNodeText,
        'font-size': (ele: Ele) => ele.data('fontSize') || 10,
        'font-weight': 600,
        'text-wrap': 'wrap',
        'text-max-width': (ele: Ele) => ele.data('textMaxWidth') || 36,
        'text-outline-width': 0,
        'text-background-opacity': 0,
        width: (ele: Ele) => ele.data('size') || 64,
        height: (ele: Ele) => ele.data('size') || 64,
        'border-width': 2,
        'border-color': theme.border,
        'border-opacity': 1,
        'min-zoomed-font-size': 4,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': theme.accent,
        'border-color': onNodeText,
        'border-width': 3,
        color: theme.accentForeground,
      },
    },
    {
      selector: 'node:active',
      style: { 'overlay-opacity': 0.12, 'overlay-color': theme.primary },
    },
    // 与正文同色：背景/文字/形状全部取自 data
    {
      selector: 'node.colorized',
      style: {
        'background-color': 'data(color)',
        color: 'data(textColor)',
        shape: 'data(shape)',
        'border-color': theme.card,
      },
    },
    {
      selector: 'node.colorized:selected',
      style: {
        'background-color': 'data(color)',
        color: 'data(textColor)',
        'border-color': theme.foreground,
        'border-width': 4,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': edgeColor,
        'target-arrow-color': edgeColor,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.85,
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': 10,
        'font-weight': 500,
        color: edgeLabelColor,
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'text-background-color': labelBg,
        'text-background-opacity': 0.92,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        opacity: 0.88,
      },
    },
    {
      selector: 'edge:selected',
      style: { width: 2.5, 'line-color': theme.primary, 'target-arrow-color': theme.primary, opacity: 1 },
    },
    // ---- 联动状态（放在最后，优先级最高） ----
    { selector: 'node.hit', style: { 'border-width': 3, 'border-color': theme.foreground } },
    {
      selector: 'node.focused',
      style: { 'border-width': 5, 'border-color': theme.foreground, 'overlay-color': theme.foreground, 'overlay-opacity': 0.14 },
    },
    { selector: 'node.dim', style: { opacity: 0.2 } },
    { selector: 'edge.dim', style: { opacity: 0.1 } },
    { selector: '.gone, .filtered', style: { display: 'none' } },
  ]
}
