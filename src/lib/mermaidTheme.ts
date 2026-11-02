/**
 * mermaid 图内配色：跟随品牌（宣纸 / 松烟墨 / 朱砂）与明暗主题。
 *
 * 为什么需要它：mermaid 自带的 `default` / `dark` 主题是**蓝灰体系**（节点底 `#ECECFF`、
 * 边线 `#9370DB`），与本项目的宣纸底 + 松烟墨字 + 朱砂主色完全不是一回事。图是用
 * `<img src="data:image/svg+xml,…">` 呈现的图片文档，**继承不到宿主 CSS**，所以颜色只能
 * 在渲染时以字面量写进 SVG。
 *
 * 做法：把主题 token 解析成 hex，交给 mermaid 的 `themeVariables`。底色仍用 mermaid 的
 * `default` / `dark` 作为基底（未覆盖的图型细节仍有合理默认），但**所有可见颜色**都由品牌
 * token 决定——换主题时重新 initialize，图会跟着换色。
 *
 * 纯模块（不引 React）：`mermaidThemeVariables` 是纯函数，可直接单测；`readThemeTokens`
 * 负责读 DOM。
 */

import { resolveCssVarColor } from './cssColor'

/** 主题 token 名 → 具体色值（读不到 CSS 变量时的兜底，与 index.css 的实测值一致） */
export const THEME_TOKEN_NAMES = [
  'primary',
  'primary-muted',
  'foreground',
  'muted',
  'muted-foreground',
  'card',
  'background',
  'border',
  'accent',
  'warning',
  'warning-muted',
  'success',
  'success-muted',
  'info',
  'info-muted',
  'destructive',
  'destructive-muted',
] as const

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]
export type ThemeTokens = Record<ThemeTokenName, string>

/**
 * 兜底色：浏览器实测 index.css 的 token（含 color-mix 出来的淡底）。
 * index.css 改了这里要跟着改——tests/mermaidTheme.test.ts 会核对。
 */
export const FALLBACK_TOKENS_LIGHT: ThemeTokens = {
  primary: '#b4341f',
  'primary-muted': '#f6e0d8',
  foreground: '#251f1c',
  muted: '#ebe4dc',
  'muted-foreground': '#6c6158',
  card: '#fdfbf7',
  background: '#f8f2ea',
  border: '#dad1c7',
  accent: '#efdbcf',
  warning: '#975800',
  'warning-muted': '#efe3d6',
  success: '#197037',
  'success-muted': '#dee7da',
  info: '#2e598f',
  'info-muted': '#dee3e8',
  destructive: '#be222a',
  'destructive-muted': '#f9dfd9',
}

export const FALLBACK_TOKENS_DARK: ThemeTokens = {
  primary: '#e4694b',
  'primary-muted': '#3d2720',
  foreground: '#e9e4dc',
  muted: '#2b2522',
  'muted-foreground': '#9b948c',
  card: '#1d1816',
  background: '#14100d',
  border: '#38312e',
  accent: '#3b2824',
  warning: '#e9b452',
  'warning-muted': '#3c3122',
  success: '#6fc884',
  'success-muted': '#2d3427',
  info: '#79a7e2',
  'info-muted': '#2d2f35',
  destructive: '#e55551',
  'destructive-muted': '#291815',
}

/** 读当前主题的 token（`--primary` 等），读不到就用兜底值 */
export function readThemeTokens(dark: boolean, root?: Element | null): ThemeTokens {
  const fallback = dark ? FALLBACK_TOKENS_DARK : FALLBACK_TOKENS_LIGHT
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
  if (!el || typeof getComputedStyle !== 'function') return { ...fallback }
  const style = getComputedStyle(el)
  const out = {} as ThemeTokens
  for (const name of THEME_TOKEN_NAMES) {
    const raw = style.getPropertyValue(`--${name}`).trim()
    out[name] = raw ? resolveCssVarColor(`var(--${name})`, fallback[name]) : fallback[name]
  }
  return out
}

export interface MermaidThemeInput {
  tokens: ThemeTokens
  /** 图内字体栈（与正文同栈） */
  fontStack: string
  /** 图内字号（px，与正文同字号） */
  fontSizePx: number
  /** 深色主题（投影用黑色而不是灰白） */
  dark?: boolean
}

/**
 * 生成 mermaid 的 `themeVariables`。
 *
 * 覆盖范围：节点/簇/边/标签/注释/时序图泳道/状态图/思维导图都照顾到——凡是能看见颜色的地方
 * 都用品牌 token，不再留 mermaid 默认的蓝紫。
 */
export function mermaidThemeVariables({ tokens, fontStack, fontSizePx, dark = false }: MermaidThemeInput): Record<string, string> {
  const t = tokens
  return {
    // 字体：与正文同栈同字号
    fontFamily: fontStack,
    fontSize: `${fontSizePx}px`,

    // 画布与全局文字
    background: t.background,
    mainBkg: t.card,
    textColor: t.foreground,
    titleColor: t.foreground,

    // 一级：朱砂（节点 / 强调）
    primaryColor: t['primary-muted'],
    primaryTextColor: t.foreground,
    primaryBorderColor: t.primary,

    // 二级：淡墨（次级节点）
    secondaryColor: t.muted,
    secondaryTextColor: t.foreground,
    secondaryBorderColor: t.border,

    // 三级：宣纸（第三层 / 叶子）
    tertiaryColor: t.card,
    tertiaryTextColor: t.foreground,
    tertiaryBorderColor: t.border,

    // 连线与标签
    lineColor: t['muted-foreground'],
    // 箭头头部是**独立变量**（不跟 lineColor 走）——不覆盖就会留下 mermaid 默认的 #333333
    arrowheadColor: t.foreground,
    // 节点渐变填充（useGradient）与投影：mermaid 默认用灰白渐变 + 灰影，深色下会发灰
    gradientStart: t.primary,
    gradientStop: t.border,
    dropShadow: dark
      ? 'drop-shadow( 1px 2px 2px rgba(0,0,0,0.45))'
      : 'drop-shadow( 1px 2px 2px rgba(37,31,28,0.18))',
    // tooltip 边框（border2）与错误框（errorBkg/Text）同理，都是 mermaid 的私有变量
    border1: t.primary,
    border2: t.border,
    errorBkgColor: t['destructive-muted'],
    errorTextColor: t.destructive,
    nodeBorder: t.border,
    nodeTextColor: t.foreground,
    edgeLabelBackground: t.card,
    labelBoxBkgColor: t.card,
    labelBoxBorderColor: t.border,
    labelTextColor: t.foreground,
    loopTextColor: t.foreground,
    edgeLabelTextColor: t.foreground,

    // 簇（子图）
    clusterBkg: t.muted,
    clusterBorder: t.border,
    clusterTextColor: t.foreground,

    // 时序图
    actorBkg: t.card,
    actorBorder: t.border,
    actorTextColor: t.foreground,
    actorLineColor: t['muted-foreground'],
    signalColor: t.foreground,
    signalTextColor: t.foreground,
    activationBkgColor: t['primary-muted'],
    activationBorderColor: t.primary,

    // 注释
    noteBkgColor: t['warning-muted'],
    noteTextColor: t.foreground,
    noteBorderColor: t.warning,

    // 状态图
    stateBkg: t.card,
    stateBorder: t.border,
    stateLabelColor: t.foreground,
    stateLabelBkg: t.card,
    stateLabelTextColor: t.foreground,
    stateTitleColor: t.foreground,
    stateNoteColor: t.foreground,
    stateDiagramLabelColor: t.foreground,

    // 甘特图 / 任务图（导图模式可能用到）
    taskBkgColor: t.card,
    taskBorderColor: t.border,
    taskTextColor: t.foreground,
    taskTextDarkColor: t.foreground,
    taskTextOutsideColor: t.foreground,
    taskTextLightColor: t.foreground,
    taskTextClickableColor: t.primary,
    activeTaskBkgColor: t['primary-muted'],
    activeTaskBorderColor: t.primary,
    excludeBkgColor: t.muted,
    critBorderColor: t.destructive,
    sectionBkgColor2: t.muted,
    secondBkg: t['warning-muted'],

    // 思维导图 / 象限图 / 时间线
    cScale0: t.card,
    cScale1: t['primary-muted'],
    cScale2: t.muted,
    cScale3: t.accent,
    cScale4: t['success-muted'],
    cScale5: t['info-muted'],
    cScale6: t['warning-muted'],
    cScale7: t['destructive-muted'],
    cScale8: t.accent,
    cScale9: t.muted,
    cScale10: t.card,
    cScale11: t.muted,
    pie1: t.primary,
    pie2: t.info,
    pie3: t.success,
    pie4: t.warning,
    pie5: t.destructive,
    pieTitleTextColor: t.foreground,
    pieSectionTextColor: t.foreground,
    pieLegendTextColor: t.foreground,
    quadrant1FillColor: t.card,
    quadrant2FillColor: t.muted,
    quadrant3FillColor: t.accent,
    quadrant4FillColor: t['primary-muted'],
    quadrantTitleColor: t.foreground,
    quadrantLabelColor: t.foreground,
  }
}
