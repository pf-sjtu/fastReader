/**
 * 离线学习包接线层（openspec 任务 7.2「离线学习包 HTML」）。
 *
 * `src/study/pack/**` 只做「有什么数据 → 什么 HTML」的纯函数；这一层负责把它接到工作区的真实数据上：
 * 章节 / 总结 / 关联 / 综述 / 图谱来自 `BookSummary`，笔记来自笔记 store（先按当前章节归位），
 * 自测与作答来自速读 store。
 *
 * 只有界面层才知道的两件事：
 * - **色值必须落成具体颜色**：`entityColors` 给的是 `var(--entity-N)`，离线包里没有这些变量，
 *   导出时要用 `getComputedStyle` 解析成当前主题下的真实颜色（见 `resolveCssColorVar`）。
 * - **图片只收能低成本做到的**：阅读器里的 mermaid 图块可以就地转成 data URI；人物关系图谱与
 *   实体时间线要改既有组件或引新依赖，结论表见 `src/study/pack/captureImages.ts`。
 *
 * 拿不到图只提示、不影响整包导出：学习包的价值在正文、笔记与自测。
 */
import { buildEntityStyles } from '@/charts/linking/entityColors'
import { getEntityGraph, type BookCharts } from '@/charts/types'
import { listRichBlocks } from '@/lib/richBlocks'
import { resolveChapterIndex, visibleNotes, type ChapterRef, type Note } from '@/notes/notes'
import {
  buildStudyPackHtml,
  captureDiagramImages,
  collectPackData,
  DEFAULT_PACK_LABELS,
  type DiagramSource,
  type PackImage,
  type PackLabels,
  type PackNote,
  type PackPerson,
  type SvgRenderFn,
} from '@/study/pack'
import { personGraphFigure, timelineFigure, type FigureColorOf } from '@/study/exportFigures'
import { triggerTextDownload } from '@/utils/download'
import { sanitizeFileName } from '@/utils/file'

/** 章节来源：`ChapterRef` + 可选的 `summary`（正文与笔记定位都用它） */
export interface PackChapterSource extends ChapterRef {
  summary?: string
}

export interface PackBookSource {
  title: string
  author?: string
  chapters: readonly PackChapterSource[]
  connections?: string
  overallSummary?: string
}

/** 自测题与作答：结构取自 `src/study/schema.ts` 与 `src/study/persistence.ts`，这里只声明用到的字段 */
export interface PackQuizSource {
  questions: readonly {
    question: string
    options?: string[]
    answerIndex?: number
    explanation?: string
  }[]
}

export interface PackAnswerSource {
  picked: number | null
  correct: boolean
}

export interface PackHtmlInput {
  book: PackBookSource
  charts?: BookCharts | null
  notes: readonly Note[]
  quiz?: PackQuizSource | null
  answers?: Readonly<Record<string, PackAnswerSource>>
  labels: PackLabels
  /** 生成时间（毫秒）；不传取当前时刻 */
  now?: number
  /** 传 false 整包不出图（含图谱与时间线的自绘 SVG，也不去截 mermaid） */
  images?: boolean
  /** 测试注入的 SVG 渲染器；不传用应用内的 mermaid */
  renderSvg?: SvgRenderFn
  /** 测试注入的色值解析；不传读页面上的 CSS 变量 */
  resolveColor?: (cssVar: string) => string
}

export interface PackHtmlResult {
  html: string
  /** 成功内嵌的图片张数 */
  images: number
  /** 没能导出的图题（由调用方决定提示还是忽略） */
  failed: string[]
  /** 建议的文件名（含 `.html`） */
  filename: string
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

/**
 * 笔记 → 学习包条目：先按当前章节归位（总结重生成后章节标题可能变了，`resolveChapterIndex`
 * 会按 id / 标题 / 序号找回来），实在找不到才退回笔记自己记的章节标题 —— 学习包按标题分组，
 * 因此「归位」这一步直接决定了笔记会落在哪一节。
 */
export function packNotesOf(notes: readonly Note[], chapters: readonly PackChapterSource[]): PackNote[] {
  const out: PackNote[] = []
  for (const note of visibleNotes(notes)) {
    if (!note.quote.trim()) continue
    const at = resolveChapterIndex(note, chapters)
    const chapterTitle = (at >= 0 ? chapters[at]?.title : undefined) ?? note.chapterTitle
    out.push({
      chapterTitle: chapterTitle.trim(),
      quote: note.quote.trim(),
      comment: note.comment.trim(),
      color: note.color,
    })
  }
  return out
}

/**
 * 人物志：`buildEntityStyles` 里形状为 `circle` 的就是人物（见 `shapeForType`）。
 * 颜色必须由调用方解析成具体色值：离线包里没有 `var(--entity-N)`。
 */
export function peopleOf(
  charts: BookCharts | null | undefined,
  resolveColor: (cssVar: string) => string
): PackPerson[] {
  if (!charts) return []
  const descriptions = new Map<string, string>()
  for (const node of getEntityGraph(charts)?.nodes ?? []) {
    const desc = node.description?.trim()
    if (desc) descriptions.set(node.id, desc)
  }
  for (const entity of charts.entityTimeline?.entities ?? []) {
    const desc = entity.description?.trim()
    if (desc && !descriptions.has(entity.id)) descriptions.set(entity.id, desc)
  }
  const people: PackPerson[] = []
  for (const style of buildEntityStyles(charts).values()) {
    if (style.shape !== 'circle') continue
    const desc = descriptions.get(style.id)
    people.push({ name: style.name, color: resolveColor(style.cssVar), ...(desc ? { desc } : {}) })
  }
  return people
}

/**
 * 图谱与时间线：用 `BookCharts` 的数据离线重绘 SVG（见 `exportFigures.ts` 里为什么不是截图）。
 * 顺序是「人物关系图 → 实体时间线 → 正文里的图块」，学习包按顺序铺开。
 */
export function figureImagesOf(
  charts: BookCharts | null | undefined,
  labels: PackLabels,
  resolveColor: (cssVar: string) => string
): PackImage[] {
  if (!charts) return []
  const styles = buildEntityStyles(charts)
  const colorOf: FigureColorOf = (entityId, fallback) => {
    const style = styles.get(entityId)
    if (style) return resolveColor(style.cssVar)
    if (!fallback) return resolveColor('var(--entity-neutral)')
    // 布局层给的回退色已经是具体色值，只有 `var(...)` 才需要解析
    return fallback.startsWith('var(') ? resolveColor(fallback) : fallback
  }
  const figures: PackImage[] = []
  const graph = personGraphFigure(charts, colorOf, labels.graph)
  if (graph) figures.push(graph)
  const timeline = timelineFigure(charts, colorOf, labels.timeline)
  if (timeline) figures.push(timeline)
  return figures
}

/** 章节正文里的 mermaid 图块（截断的坏块不导出：源本身就不完整） */
export function mermaidSourcesOf(chapters: readonly PackChapterSource[]): DiagramSource[] {
  const sources: DiagramSource[] = []
  chapters.forEach((chapter, index) => {
    for (const block of listRichBlocks(chapter.summary ?? '')) {
      if (block.lang !== 'mermaid' || block.truncated || !block.code.trim()) continue
      sources.push({ title: chapter.title.trim() || `#${index + 1}`, code: block.code.trim() })
    }
  })
  return sources
}

/**
 * `var(--entity-3)` → 当前主题下该变量的真实颜色。
 *
 * 解析不出来时退回 `currentColor` 而不是空串：空串会让 `style="border-color:"` 这种
 * 坏样式写进 HTML，`currentColor` 至少能跟着学习包的文字色走。
 */
export function resolveCssColorVar(cssVar: string): string {
  const name = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(cssVar.trim())?.[1]
  if (!name || typeof document === 'undefined') return 'currentColor'
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || 'currentColor'
}

/**
 * i18n：`study.pack.*` → 学习包内固定文案。
 *
 * 词典缺键时用 `DEFAULT_PACK_LABELS`（中文）兜底，而不是让学习包里出现 `study.pack.toc`
 * 这种键名 —— 离线包是要给人看、甚至打印的。
 */
export function packLabels(t: TranslateFn): PackLabels {
  const text = (key: Exclude<keyof PackLabels, 'questionNo' | 'countOf'>): string =>
    t(`study.pack.${key}`, { defaultValue: DEFAULT_PACK_LABELS[key] })
  return {
    docTitleSuffix: text('docTitleSuffix'),
    untitled: text('untitled'),
    toc: text('toc'),
    chapters: text('chapters'),
    notes: text('notes'),
    quiz: text('quiz'),
    connections: text('connections'),
    overallSummary: text('overallSummary'),
    people: text('people'),
    images: text('images'),
    graph: text('graph'),
    timeline: text('timeline'),
    emptyChapter: text('emptyChapter'),
    author: text('author'),
    generatedAt: text('generatedAt'),
    correctAnswer: text('correctAnswer'),
    yourChoice: text('yourChoice'),
    explanation: text('explanation'),
    questionNo: (n) => t('study.pack.questionNo', { n, defaultValue: DEFAULT_PACK_LABELS.questionNo(n) }),
    countOf: (unit, n) =>
      t('study.pack.countOf', { unit, n, defaultValue: DEFAULT_PACK_LABELS.countOf(unit, n) }),
  }
}

/** `人类简史` + `学习包` → `人类简史-学习包.html` */
export function studyPackFileName(title: string, suffix: string): string {
  const base = sanitizeFileName(`${title.trim() || 'book'}-${suffix.trim() || 'pack'}`)
  return `${base}.html`
}

function quizQuestionsOf(quiz: PackQuizSource | null | undefined) {
  return (quiz?.questions ?? []).map((question) => {
    const explanation = question.explanation?.trim()
    return {
      question: question.question,
      options: [...(question.options ?? [])],
      // 开放题没有选项：`-1` 与 `[]` 组合等于「不标答案」，与 collect 的语义一致
      answerIndex: typeof question.answerIndex === 'number' ? question.answerIndex : -1,
      ...(explanation ? { explanation } : {}),
    }
  })
}

function answersOf(answers: Readonly<Record<string, PackAnswerSource>> | undefined) {
  const out: Record<string, { correct: boolean; chosen?: number }> = {}
  for (const [id, answer] of Object.entries(answers ?? {})) {
    out[id] = {
      correct: answer.correct,
      ...(typeof answer.picked === 'number' ? { chosen: answer.picked } : {}),
    }
  }
  return out
}

/** 组装并渲染整包（图片可选）。失败只反映在 `failed` 里，正文与笔记照常导出 */
export async function buildPackHtml(input: PackHtmlInput): Promise<PackHtmlResult> {
  const { book, labels } = input
  const resolveColor = input.resolveColor ?? resolveCssColorVar
  const figures = input.images === false ? [] : figureImagesOf(input.charts, labels, resolveColor)
  const sources = mermaidSourcesOf(book.chapters)
  const captured =
    input.images === false || !sources.length
      ? { images: [] as PackImage[], failed: [] as { title: string; error: string }[] }
      : await captureDiagramImages(sources, input.renderSvg)
  const images = [...figures, ...captured.images]

  const questions = quizQuestionsOf(input.quiz)
  const data = collectPackData({
    book: {
      title: book.title,
      ...(book.author ? { author: book.author } : {}),
      chapters: book.chapters.map((chapter) => ({ title: chapter.title, summary: chapter.summary })),
    },
    ...(book.connections ? { connections: book.connections } : {}),
    ...(book.overallSummary ? { overallSummary: book.overallSummary } : {}),
    notes: packNotesOf(input.notes, book.chapters),
    study: questions.length ? { quiz: { questions }, answers: answersOf(input.answers) } : null,
    people: peopleOf(input.charts, resolveColor),
    images,
    ...(input.now === undefined ? {} : { now: input.now }),
  })

  return {
    html: buildStudyPackHtml(data, { labels }),
    images: images.length,
    failed: captured.failed.map((item) => item.title),
    filename: studyPackFileName(book.title, labels.docTitleSuffix),
  }
}

/** 下载：HTML 不带 BOM（`<!doctype>` 之前多一个零宽字符是自找麻烦） */
export function downloadPackHtml(html: string, filename: string): void {
  triggerTextDownload(html, filename, 'text/html;charset=utf-8', false)
}
