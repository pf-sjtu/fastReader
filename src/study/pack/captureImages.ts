/**
 * 图谱 / 时间线 → 学习包内嵌图片（任务 7.2 第三阶段，探索性）。
 *
 * ## 当时查到的结论（先说清代价，免得后人重复摸索）
 *
 * 需求里的「彩色图谱 / 时间线图片」指 `src/charts/` 的两个插件。逐条查过它们的导出能力：
 *
 * | 目标 | 现状 | 低成本方案？ |
 * |---|---|---|
 * | 人物关系图谱（cytoscape） | 实例是 `PersonGraphChart.tsx` 内部的局部 `useRef`，没有实例注册表；cytoscape 核心的 `cy.png()` 能用，但拿不到实例 | ✗ 截图这条路要改既有组件（把实例暴露出来） |
 * | 实体时间线 | 是**纯 HTML/CSS div**，不含任何 `<svg>`，没有可序列化的矢量根 | ✗ 截图这条路要引 `html2canvas` 之类新依赖 |
 * | mermaid 图（阅读器里的图块） | `src/lib/mermaidRender.ts` 已导出 `renderMermaid` 与 `svgToDataUri`，全程无 DOM 依赖、无新依赖 | ✓ 本文件就是它 |
 *
 * 所以**截图**这条路本文件不做，只做「mermaid 代码 → SVG 字符串 → data URI」并包成 `PackImage`。
 * 图谱与时间线后来走了第四种做法：用 `BookCharts` 的数据**自绘 SVG**（`src/study/exportFigures.ts`），
 * 同样是零新依赖、不改既有图表组件，只是位置不逐字复刻（见该文件头部的取舍说明）。
 *
 * ## 为什么内嵌 SVG data URI 是安全的
 *
 * 与 `mindmapRender` 同一套理由：`<img src="data:image/svg+xml,...">` 里的脚本不会执行，
 * 且 `renderMermaid` 用的是 `securityLevel: 'strict'`。学习包因此不含任何外部请求，断网可读。
 */
import { renderMermaid, svgToDataUri, type MermaidResult } from '@/lib/mermaidRender'
import type { PackImage } from './buildPack'

/** 渲染函数签名：与 `renderMermaid` 一致，测试可注入假实现而不启动 mermaid */
export type SvgRenderFn = (code: string) => Promise<MermaidResult>

export interface DiagramSource {
  /** 图题：作为 `<figcaption>` */
  title: string
  /** mermaid 代码 */
  code: string
}

export interface CaptureResult {
  /** 可直接塞进 `PackData.images` */
  images: PackImage[]
  /** 截不到的图（代码为空 / 语法错 / 超时）：由调用方决定提示还是忽略 */
  failed: { title: string; error: string }[]
}

/**
 * 取应用内 mermaid 渲染器。
 * `dark` 固定传 `false`：学习包按亮色主题打印（见 buildPack 的 STYLE 注释），
 * 深色主题的图在白纸上会看不清。
 */
export function defaultSvgRenderer(): SvgRenderFn {
  return (code) => renderMermaid(code, false)
}

/**
 * 批量把 mermaid 代码转成内嵌图片。
 *
 * 渲染失败只影响那一张图：其余照常返回，失败原因收在 `failed` 里，绝不抛异常中断整个导出——
 * 学习包的价值在正文与笔记，不该因为一张图画不出来就让用户什么都拿不到。
 *
 * @param items 图列表，顺序即输出顺序
 * @param render 渲染函数，默认用应用内的 mermaid（单测注入假实现）
 */
export async function captureDiagramImages(
  items: readonly DiagramSource[],
  render: SvgRenderFn = defaultSvgRenderer()
): Promise<CaptureResult> {
  const images: PackImage[] = []
  const failed: { title: string; error: string }[] = []

  for (const item of items) {
    const code = item.code.trim()
    if (!code) {
      failed.push({ title: item.title, error: '图为空' })
      continue
    }
    try {
      const result = await render(code)
      if (!result.ok) {
        failed.push({ title: item.title, error: result.error })
        continue
      }
      const svg = result.svg.trim()
      if (!svg) {
        failed.push({ title: item.title, error: '渲染结果为空' })
        continue
      }
      images.push({ title: item.title, dataUri: svgToDataUri(svg) })
    } catch (e) {
      failed.push({ title: item.title, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { images, failed }
}
