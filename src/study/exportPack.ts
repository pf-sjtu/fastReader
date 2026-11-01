/**
 * 离线学习包接线层（openspec 任务 7.2「离线学习包 HTML」）。
 *
 * `src/study/pack/**` 只做「有什么数据 → 什么 HTML」的纯函数；这一层负责把它接到工作区的真实数据上：
 * 章节 / 总结 / 关联 / 综述 / 图谱来自 `BookSummary`，笔记来自笔记 store（先按当前章节归位），
 * 自测与作答来自速读 store。
 *
 * 只有界面层才知道的两件事：
 * - **色值必须落成具体颜色**：`entityColors` 给的是 `var(--entity-N)`，离线包里没有这些变量。
 *   但**不能**读当前主题的计算值：学习包固定亮色纸面，暗色主题会把这些 token 整体提亮，
 *   照当前主题取色会让白纸上的对比度掉到 2:1 左右。所以查的是固定亮色表（见 `PACK_ENTITY_PALETTE`）。
 * - **图片只收能低成本做到的**：阅读器里的 mermaid 图块可以就地转成 data URI；人物关系图谱与
 *   实体时间线由 `exportFigures.ts` 用 `BookCharts` 数据自绘 SVG（改动与代价见
 *   `src/study/pack/captureImages.ts` 的结论表）。
 *
 * 拿不到图只提示、不影响整包导出：学习包的价值在正文、笔记与自测。
 */
import { buildEntityStyles } from '@/charts/linking/entityColors'
import { getEntityGraph, type BookCharts } from '@/charts/types'
import i18n from '@/i18n'
import { listRichBlocks } from '@/lib/richBlocks'
import { resolveChapterIndex, visibleNotes, type ChapterRef, type Note } from '@/notes/notes'
import {
  buildStudyPackHtml,
  captureDiagramImages,
  collectPackData,
  DEFAULT_PACK_LABELS,
  DEFAULT_PACK_LANG,
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
  /** 文档语言（`<html lang>`）；不传跟随当前界面语言（见 `currentPackLang`） */
  lang?: string
  /** 测试注入的 SVG 渲染器；不传用应用内的 mermaid */
  renderSvg?: SvgRenderFn
  /** 测试注入的色值解析；不传用固定亮色实体色表（见 `resolveEntityColor`） */
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
 * 实体色的**亮色**表：与 `src/index.css` 亮色主题的 `--entity-1..10` / `--entity-neutral` 逐字一致。
 *
 * 为什么不读 `getComputedStyle`：学习包固定亮色纸面（见 `buildPack.ts` 的 STYLE —— 它要能被打印，
 * 跟着纸张走），而 `.dark` 把这批 token 整体提亮了（`--entity-1` 明度 0.52 → 0.70）。照当前主题
 * 取值会让深色主题下导出的实体色在白纸上的对比度从 5.39:1 掉到 2.57:1（`--entity-3` 3.92:1 → 1.69:1），
 * 图谱与人物志也跟着一起看不清。
 *
 * 与 `buildPack.ts` 的 `NOTE_PALETTE` 是同一约定：**`src/index.css` 亮色 token 改值时要同步这里**。
 */
export const PACK_ENTITY_PALETTE: Readonly<Record<string, string>> = {
  '--entity-1': 'oklch(0.5200 0.1700 32.0)',
  '--entity-2': 'oklch(0.4600 0.1100 255.0)',
  '--entity-3': 'oklch(0.5800 0.1200 80.0)',
  '--entity-4': 'oklch(0.5000 0.1000 150.0)',
  '--entity-5': 'oklch(0.4600 0.1100 305.0)',
  '--entity-6': 'oklch(0.5000 0.0900 205.0)',
  '--entity-7': 'oklch(0.5000 0.1600 8.0)',
  '--entity-8': 'oklch(0.4400 0.0650 60.0)',
  '--entity-9': 'oklch(0.5400 0.0900 115.0)',
  '--entity-10': 'oklch(0.5600 0.1000 340.0)',
  '--entity-neutral': 'oklch(0.5200 0.0150 70.0)',
}

/**
 * `var(--entity-3)` → 学习包固定亮色表里的颜色（**不看当前主题**，理由见 `PACK_ENTITY_PALETTE`）。
 *
 * 解析不出来时退回 `currentColor` 而不是空串：空串会让 `style="border-color:"` 这种
 * 坏样式写进 HTML，`currentColor` 至少能跟着学习包的文字色走。
 */
export function resolveEntityColor(cssVar: string): string {
  const name = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(cssVar.trim())?.[1]
  if (!name) return 'currentColor'
  return PACK_ENTITY_PALETTE[name] ?? 'currentColor'
}

/**
 * 界面语言 → 学习包 `<html lang>`。
 *
 * 离线包不引 i18next，但 `lang` 决定浏览器的断词、拼写检查与读屏器发音，必须与包内文案一致；
 * 而文案只是 `zh` / 其余两档（`PackLabels` 就两套 locale），所以这里同样只分两档。
 * 空/未知退回 `DEFAULT_PACK_LANG`，与默认中文文案对齐。
 */
export function packLangOf(language: string | undefined): string {
  const lang = (language ?? '').trim().toLowerCase()
  if (!lang) return DEFAULT_PACK_LANG
  return lang.startsWith('zh') ? 'zh-CN' : 'en'
}

/** 当前界面语言下的学习包 `lang`（文案由 `packLabels(t)` 按同一份 i18n 生成） */
export function currentPackLang(): string {
  return packLangOf(i18n?.language)
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

/**
 * 文件名主干（不含 `.html`）的字符上限。
 *
 * Windows 单段文件名上限 255，但学习包是「书名 + 后缀」，书名可能整段是 AI 生成的章节式长标题
 * （实测 120 字标题会产出 130+ 字符的文件名），加上目录层次、云盘同步重名时追加的「(1)」就危险了。
 * 留出余量截到 80，后缀始终保留 —— 它是这个文件「是什么」的唯一标识。
 */
const FILENAME_MAX_LENGTH = 80

/** 按码点截断：直接 slice 可能把代理对（emoji）劈成半个字符 */
const truncate = (text: string, max: number): string => Array.from(text).slice(0, Math.max(0, max)).join('')

/** `人类简史` + `学习包` → `人类简史-学习包.html`（标题过长时截标题一侧，后缀不截） */
export function studyPackFileName(title: string, suffix: string): string {
  const head = sanitizeFileName(title.trim() || 'book')
  const tail = sanitizeFileName(suffix.trim() || 'pack')
  const room = FILENAME_MAX_LENGTH - tail.length - 1
  const fit = head.length <= room ? head : truncate(head, room)
  return `${fit}-${tail}.html`
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
  const resolveColor = input.resolveColor ?? resolveEntityColor
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
    html: buildStudyPackHtml(data, { labels, lang: input.lang ?? currentPackLang() }),
    images: images.length,
    failed: captured.failed.map((item) => item.title),
    filename: studyPackFileName(book.title, labels.docTitleSuffix),
  }
}

/** 下载：HTML 不带 BOM（`<!doctype>` 之前多一个零宽字符是自找麻烦） */
export function downloadPackHtml(html: string, filename: string): void {
  triggerTextDownload(html, filename, 'text/html;charset=utf-8', false)
}
