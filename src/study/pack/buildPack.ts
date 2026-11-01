/**
 * 离线单文件学习包 HTML 生成核心（openspec 任务 7.2 / spec notes「Requirement: 导出」）。
 *
 * 三条硬约束贯穿本文件：
 *
 * 1. **完全自包含**：输出里没有任何外部 URL——不引 `<script>`、不引 `<link>`、不用网络字体，
 *    图片只接受 `data:image/...` 内联 URI（其余一律丢弃，见 imagesOf）。文件落地后断网可读。
 *    交付形式就是「一个 HTML 文件」，因此本文件不产生任何副作用、不做下载，只返回字符串。
 * 2. **一切外来文本先转义再拼装**：章节总结、笔记原文、题目、书名都可能来自 AI 输出或用户输入。
 *    全部过 `escapeHtml`，拼装时只插入本文件自己生成的标签。
 *    处理的先后是「先转义、后做最小 Markdown 处理」，所以 Markdown 识别不可能被构造出标签。
 * 3. **颜色只内联解析值**：独立 HTML 引用不到应用的 CSS 变量，只能写死解析后的颜色。
 *    笔记四色取自 `src/index.css` 亮色主题的 `--primary` / `--info` / `--success` / `--warning`
 *    （与应用内 `src/components/notes/NotesPanel.tsx` 的 `border-l-primary|info|success|warning`
 *    完全同语义）；纸墨底色同源取 `--background` / `--foreground` / `--card` / `--border` / `--muted`。
 *    人物志与实体颜色一律**由调用方传入**（图谱节点色由 `src/charts/linking/entityColors.ts` 分配），
 *    本文件不含实体调色板，避免与「同一实体处处同色」的规则各自为政。
 */

export interface PackChapter {
  index: number
  title: string
  summary: string
}

export interface PackNote {
  chapterTitle: string
  quote: string
  comment: string
  color: 1 | 2 | 3 | 4
}

export interface PackQuizItem {
  question: string
  options: string[]
  answerIndex: number
  explanation?: string
  chosen?: number
}

export interface PackPerson {
  name: string
  /** 已解析的颜色值（如 `hsl(...)` / `#rrggbb` / `oklch(...)`），由调用方给出 */
  color: string
  desc?: string
}

export interface PackImage {
  title: string
  dataUri: string
}

export interface PackData {
  title: string
  author?: string
  generatedAt: number
  chapters: PackChapter[]
  connections?: string
  overallSummary?: string
  notes: PackNote[]
  quiz: PackQuizItem[] | null
  people?: PackPerson[]
  images?: PackImage[]
}

/**
 * 笔记四色默认值：`src/index.css` 亮色主题 token 的解析值（原样 oklch）。
 * 顺序与 `NoteColor`（1..4）一致，语义 = 朱砂 / 花青 / 竹青 / 藤黄。
 *
 * 学习包固定亮色纸面，所以默认值只能是**亮色** token；`noteColors` 覆盖是给测试或未来换配色留的，
 * 不要拿当前主题（尤其暗色）的计算值来覆盖 —— 那会让纸面上的对比度掉到 2:1 左右
 * （实体色同此道理，见 `src/study/exportPack.ts` 的 `PACK_ENTITY_PALETTE`）。
 */
export const NOTE_PALETTE: Readonly<Record<1 | 2 | 3 | 4, string>> = {
  1: 'oklch(0.5150 0.1680 32.0)',
  2: 'oklch(0.4600 0.1000 255.0)',
  3: 'oklch(0.4800 0.1200 150.0)',
  4: 'oklch(0.5200 0.1200 65.0)',
}

/**
 * 学习包界面文案。
 *
 * 学习包是给最终用户看的成品，文案本应跟随界面语言；但离线包在一个纯函数里生成，
 * 读不到 i18next（也不该读）。所以把文案做成可覆盖项：接线方按当前语言传入一份
 * 本地化文案即可，默认是中文。
 */
export interface PackLabels {
  /** 文档标题后缀：`书名 · 学习包` */
  docTitleSuffix: string
  /** 标题为空时的占位 */
  untitled: string
  toc: string
  chapters: string
  notes: string
  quiz: string
  connections: string
  overallSummary: string
  people: string
  images: string
  /** 人物关系图的图题 */
  graph: string
  /** 实体时间线的图题 */
  timeline: string
  emptyChapter: string
  author: string
  generatedAt: string
  correctAnswer: string
  yourChoice: string
  explanation: string
  /** 「第 3 题」 */
  questionNo: (n: number) => string
  /** 「章节 2」「笔记 5」这类计数 */
  countOf: (unit: string, n: number) => string
}

export const DEFAULT_PACK_LABELS: PackLabels = {
  docTitleSuffix: '学习包',
  untitled: '未命名',
  toc: '目录',
  chapters: '章节总结',
  notes: '笔记',
  quiz: '自测题',
  connections: '关联',
  overallSummary: '全书综述',
  people: '人物志',
  images: '图谱与时间线',
  graph: '人物关系图',
  timeline: '实体时间线',
  emptyChapter: '（本章暂无总结）',
  author: '作者',
  generatedAt: '生成时间',
  correctAnswer: '正确答案',
  yourChoice: '你的选择',
  explanation: '解析',
  questionNo: (n) => `第 ${n} 题`,
  countOf: (unit, n) => `${unit} ${n}`,
}

/** 生成选项：都只覆盖需要变的那几条 */
export interface PackBuildOptions {
  /** 笔记四色：只想换一两条时传其中一部分即可 */
  noteColors?: Partial<Record<1 | 2 | 3 | 4, string>>
  /** 界面文案（本地化）：只想换一两条时传其中一部分即可 */
  labels?: Partial<PackLabels>
  /**
   * 文档语言（`<html lang>`）：跟随界面语言，如 `zh-CN` / `en`。
   * 不传用 `DEFAULT_PACK_LANG`（中文），保持只改 labels 的老调用方行为不变。
   */
  lang?: string
}

/** 学习包默认文档语言：文案默认也是中文，两者必须一致（读屏器与断词都看它） */
export const DEFAULT_PACK_LANG = 'zh-CN'

/**
 * HTML 转义。`&` 必须最先替换，否则后续插入的实体（`&amp;`）会被二次转义。
 * 单引号也转义：属性值可能用单引号包裹时不至于跑出属性。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 本地时间字符串（`YYYY-MM-DD HH:mm`）。
 * 用 Date 的本地取值逐段拼接，不走 `Intl`/`toLocaleString`——后者的输出随运行环境的
 * 语言与时区而变，离线包与单测都需要一个稳定的形状。
 */
export function formatLocalTime(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 章节总结的最小 Markdown 处理：标题、无序列表、段落（连续行用 `<br>` 保留换行）。
 *
 * **入参必须是已经转义过的文本**：本函数只按行首特征插入自己生成的标签，
 * 不解析行内语法（粗体/链接等一律按普通文本显示），因此不存在把用户文本变成标签的路径。
 * 只识别到这几类，是为了「不引新依赖」——完整的 Markdown 渲染器体积与安全面都不值得为导出引入。
 */
function renderMinimalMarkdown(escaped: string): string {
  const out: string[] = []
  let list: string[] = []
  let para: string[] = []
  const flushList = () => {
    if (list.length) {
      out.push(`<ul>${list.join('')}</ul>`)
      list = []
    }
  }
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.join('<br>')}</p>`)
      para = []
    }
  }

  for (const rawLine of escaped.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushPara()
      flushList()
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      // 统一降到 h4：章节标题已是 h3，总结内部的标题不应与它争层级
      out.push(`<h4>${heading[1].trim()}</h4>`)
      continue
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flushPara()
      list.push(`<li>${bullet[1].trim()}</li>`)
      continue
    }
    flushList()
    para.push(line)
  }
  flushPara()
  flushList()
  return out.join('\n')
}

/** 一段总结 → 正文 HTML；空白时返回空串（调用方据此不渲染该块） */
function summaryHtml(summary: string): string {
  return renderMinimalMarkdown(escapeHtml(summary.trim()))
}

/**
 * 笔记按章节分组：先按章节顺序取标题精确匹配的笔记，对不上任何章节的（章节标题被改过、
 * 或笔记来自上一轮总结）按标题补在最后——**绝不丢笔记**，这与 notes.ts 里保留游离笔记的做法一致。
 */
function groupNotes(
  chapters: readonly PackChapter[],
  notes: readonly PackNote[]
): { title: string; notes: PackNote[] }[] {
  const sections: { title: string; notes: PackNote[] }[] = []
  const taken = new Set<PackNote>()
  const key = (s: string) => s.trim()

  for (const chapter of chapters) {
    const mine = notes.filter((n) => !taken.has(n) && key(n.chapterTitle) === key(chapter.title))
    if (!mine.length) continue
    for (const n of mine) taken.add(n)
    sections.push({ title: chapter.title, notes: mine })
  }

  // 游离笔记：按出现顺序、同名归到一组
  const orphans = new Map<string, PackNote[]>()
  for (const note of notes) {
    if (taken.has(note)) continue
    const title = key(note.chapterTitle)
    orphans.set(title, [...(orphans.get(title) ?? []), note])
  }
  for (const [title, group] of orphans) {
    sections.push({ title: title || DEFAULT_PACK_LABELS.untitled, notes: group })
  }
  return sections
}

function renderNotes(
  chapters: readonly PackChapter[],
  notes: readonly PackNote[],
  palette: Readonly<Record<1 | 2 | 3 | 4, string>>,
  L: PackLabels
): string {
  if (!notes.length) return ''
  const sections = groupNotes(chapters, notes).map((section) => {
    const items = section.notes
      .map((note) => {
        const quote = note.quote
          .trim()
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => `<span class="quote-line">${escapeHtml(line)}</span>`)
          .join('')
        const comment = note.comment.trim()
        return [
          `<article class="note" style="border-left-color:${escapeHtml(palette[note.color])}">`,
          `<blockquote>${quote}</blockquote>`,
          comment ? `<p class="comment">${escapeHtml(comment)}</p>` : '',
          `</article>`,
        ].join('')
      })
      .join('\n')
    return [`<div class="note-group">`, `<h4>${escapeHtml(section.title)}</h4>`, items, `</div>`].join('\n')
  })
  return section('notes', L.notes, sections.join('\n'))
}

function renderQuiz(quiz: readonly PackQuizItem[] | null, L: PackLabels): string {
  if (!quiz?.length) return ''
  const items = quiz
    .map((q, qi) => {
      const options = q.options
        .map((option, oi) => {
          const isAnswer = oi === q.answerIndex
          const isChosen = q.chosen === oi
          const cls = ['opt', isAnswer ? 'is-answer' : '', isChosen ? 'is-chosen' : ''].filter(Boolean).join(' ')
          const marks = [
            isAnswer ? `<span class="mark mark-answer">${escapeHtml(L.correctAnswer)}</span>` : '',
            isChosen ? `<span class="mark mark-chosen">${escapeHtml(L.yourChoice)}</span>` : '',
          ].join('')
          return [
            `<li class="${cls}">`,
            `<span class="opt-key">${String.fromCharCode(65 + oi)}</span>`,
            `<span class="opt-text">${escapeHtml(option)}</span>`,
            marks,
            `</li>`,
          ].join('')
        })
        .join('\n')
      const explanation = q.explanation?.trim()
      return [
        `<article class="quiz-item">`,
        `<h4><span class="q-no">${escapeHtml(L.questionNo(qi + 1))}</span>${escapeHtml(q.question)}</h4>`,
        `<ul class="opts">${options}</ul>`,
        explanation
          ? `<p class="explain"><span class="explain-label">${escapeHtml(L.explanation)}</span>${escapeHtml(explanation)}</p>`
          : '',
        `</article>`,
      ].join('\n')
    })
    .join('\n')
  return section('quiz', L.quiz, items)
}

/** 人物志：圆点用调用方给的实体色。颜色进的是属性值，必须同样转义（防属性逃逸） */
function renderPeople(people: readonly PackPerson[] | undefined, L: PackLabels): string {
  if (!people?.length) return ''
  const items = people
    .map((person) => {
      const desc = person.desc?.trim()
      return [
        `<li class="person">`,
        `<span class="dot" style="background:${escapeHtml(person.color)}"></span>`,
        `<span class="person-body">`,
        `<span class="person-name">${escapeHtml(person.name)}</span>`,
        desc ? `<span class="person-desc">${escapeHtml(desc)}</span>` : '',
        `</span>`,
        `</li>`,
      ].join('')
    })
    .join('\n')
  return section('people', L.people, `<ul class="people">${items}</ul>`)
}

/** 只接受内联 data URI：外部链接会让「断网可读」失效，一律丢弃 */
function imagesOf(images: readonly PackImage[] | undefined): PackImage[] {
  return (images ?? []).filter((image) => image.dataUri.startsWith('data:image/'))
}

function renderImages(images: readonly PackImage[], L: PackLabels): string {
  if (!images.length) return ''
  const figures = images
    .map((image) =>
      [
        `<figure class="figure">`,
        `<img src="${escapeHtml(image.dataUri)}" alt="${escapeHtml(image.title)}">`,
        `<figcaption>${escapeHtml(image.title)}</figcaption>`,
        `</figure>`,
      ].join('')
    )
    .join('\n')
  return section('images', L.images, figures)
}

function renderChapters(chapters: readonly PackChapter[], L: PackLabels): string {
  if (!chapters.length) return ''
  const items = chapters
    .map((chapter, i) => {
      const body = summaryHtml(chapter.summary)
      return [
        `<article class="chapter" id="ch-${i}">`,
        `<h3>${escapeHtml(chapter.title || L.untitled)}</h3>`,
        body || `<p class="empty">${escapeHtml(L.emptyChapter)}</p>`,
        `</article>`,
      ].join('\n')
    })
    .join('\n')
  return section('chapters', L.chapters, items)
}

function renderProse(id: string, title: string, text: string): string {
  const body = summaryHtml(text)
  if (!body) return ''
  return section(id, title, body)
}

function section(id: string, title: string, body: string): string {
  return [`<section class="sec" id="${id}">`, `<h2>${escapeHtml(title)}</h2>`, body, `</section>`].join('\n')
}

/** 目录：只含内部锚点，方便长包在离线阅读器里跳转 */
function renderToc(chapters: readonly PackChapter[], L: PackLabels): string {
  if (chapters.length < 2) return ''
  const items = chapters
    .map((chapter, i) => `<li><a href="#ch-${i}">${escapeHtml(chapter.title || L.untitled)}</a></li>`)
    .join('')
  return [`<nav class="toc">`, `<h2>${escapeHtml(L.toc)}</h2>`, `<ol class="toc-list">${items}</ol>`, `</nav>`].join('\n')
}

/**
 * 独立 HTML 的样式。所有颜色都是 `src/index.css` 亮色主题 token 的内联解析值
 * （纸色 `--background`、墨色 `--foreground`、卡片 `--card`、描边 `--border`、底纹 `--muted`），
 * 离线包固定用亮色主题：它要能被打印，也跟着纸张走。
 */
const STYLE = `
*, *::before, *::after { box-sizing: border-box; }
:root {
  --pack-bg: oklch(0.9640 0.0120 78.0);
  --pack-fg: oklch(0.2450 0.0110 55.0);
  --pack-card: oklch(0.9880 0.0060 80.0);
  --pack-border: oklch(0.8650 0.0170 72.0);
  --pack-muted: oklch(0.9230 0.0140 75.0);
  --pack-muted-fg: oklch(0.4950 0.0110 60.0);
}
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 32px 20px 64px;
  background: var(--pack-bg);
  color: var(--pack-fg);
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 15px;
  line-height: 1.75;
}
.pack { max-width: 760px; margin: 0 auto; }
.cover { border-bottom: 2px solid var(--pack-border); padding-bottom: 20px; margin-bottom: 28px; }
.cover h1 {
  margin: 0 0 6px;
  font-family: Georgia, "Songti SC", "SimSun", serif;
  font-size: 30px;
  line-height: 1.3;
  letter-spacing: 0.01em;
}
.cover .author { margin: 0; color: var(--pack-muted-fg); }
.cover .meta { margin: 10px 0 0; color: var(--pack-muted-fg); font-size: 13px; }
.sec { margin: 0 0 32px; }
.sec > h2 {
  margin: 0 0 14px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--pack-border);
  font-size: 19px;
  letter-spacing: 0.02em;
}
.sec h3 { margin: 20px 0 8px; font-size: 17px; }
.sec h4 { margin: 14px 0 6px; font-size: 15px; }
.sec p { margin: 0 0 10px; }
.sec ul { margin: 0 0 10px; padding-left: 22px; }
.empty { color: var(--pack-muted-fg); font-size: 13px; }
.toc { margin: 0 0 32px; }
.toc > h2 { margin: 0 0 10px; font-size: 19px; }
.toc-list { margin: 0; padding-left: 22px; }
.toc a { color: inherit; text-decoration-color: var(--pack-border); }
.chapter { margin: 0 0 22px; }
.note-group { margin: 0 0 20px; }
.note {
  background: var(--pack-card);
  border: 1px solid var(--pack-border);
  border-left-width: 4px;
  border-radius: 8px;
  padding: 10px 14px;
  margin: 0 0 8px;
}
.note blockquote { margin: 0; color: var(--pack-fg); }
.quote-line { display: block; }
.quote-line + .quote-line { margin-top: 2px; }
.note .comment { margin: 6px 0 0; color: var(--pack-muted-fg); }
.quiz-item {
  background: var(--pack-card);
  border: 1px solid var(--pack-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 0 0 12px;
}
.quiz-item h4 { margin: 0 0 8px; display: flex; gap: 8px; align-items: baseline; }
.q-no { flex: none; color: var(--pack-muted-fg); font-size: 13px; font-weight: 400; }
.opts { list-style: none; margin: 0; padding: 0; }
.opt { display: flex; gap: 8px; align-items: baseline; padding: 4px 8px; border-radius: 6px; border: 1px solid transparent; }
.opt-key { flex: none; color: var(--pack-muted-fg); font-variant-numeric: tabular-nums; }
.opt-text { flex: 1 1 auto; }
.opt.is-answer { border-color: var(--pack-border); background: var(--pack-muted); }
.opt.is-chosen { outline: 1px dashed var(--pack-muted-fg); }
.mark { flex: none; font-size: 12px; color: var(--pack-muted-fg); }
.mark-answer { font-weight: 600; }
.explain { margin: 8px 0 0; color: var(--pack-muted-fg); font-size: 14px; }
.explain-label { margin-right: 6px; font-weight: 600; }
.people { list-style: none; margin: 0; padding: 0; }
.person { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; }
.dot { flex: none; width: 10px; height: 10px; margin-top: 8px; border-radius: 999px; }
.person-body { display: flex; flex-direction: column; }
.person-name { font-weight: 600; }
.person-desc { color: var(--pack-muted-fg); font-size: 14px; }
.figure { margin: 0 0 16px; }
.figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--pack-border); border-radius: 8px; }
.figure figcaption { margin-top: 4px; color: var(--pack-muted-fg); font-size: 13px; }
@media print {
  body { padding: 0; background: #fff; }
  /* 打印要保留彩色图谱与笔记竖条 */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cover { break-after: page; page-break-after: always; }
  .note, .quiz-item, .person, .figure, .chapter { break-inside: avoid; page-break-inside: avoid; box-shadow: none; }
  .sec > h2, .sec h3, .sec h4 { break-after: avoid; page-break-after: avoid; }
  .toc a { text-decoration: none; }
}
`.trim()

/**
 * 生成完整的学习包 HTML 文档。
 *
 * @param data 学习包数据（见 `PackData`）；`chapters` 会按 `index` 升序重排，不改动入参
 * @param options 可选：覆盖笔记四色、界面文案与 `<html lang>`（默认中文与 `NOTE_PALETTE`）
 */
export function buildStudyPackHtml(data: PackData, options?: PackBuildOptions): string {
  const palette: Readonly<Record<1 | 2 | 3 | 4, string>> = { ...NOTE_PALETTE, ...options?.noteColors }
  const L: PackLabels = { ...DEFAULT_PACK_LABELS, ...options?.labels }
  const lang = options?.lang?.trim() || DEFAULT_PACK_LANG
  const chapters = [...data.chapters].sort((a, b) => a.index - b.index)
  const title = data.title.trim() || L.untitled
  const author = data.author?.trim()
  const generated = formatLocalTime(data.generatedAt)
  const images = imagesOf(data.images)

  const metaParts = [
    author ? `${L.author}：${author}` : '',
    generated ? `${L.generatedAt}：${generated}` : '',
    L.countOf(L.chapters, chapters.length),
    L.countOf(L.notes, data.notes.length),
    data.quiz?.length ? L.countOf(L.quiz, data.quiz.length) : '',
  ].filter(Boolean)
  const connections = data.connections?.trim() ?? ''
  const overallSummary = data.overallSummary?.trim() ?? ''

  const body = [
    `<main class="pack">`,
    `<header class="cover">`,
    `<h1>${escapeHtml(title)}</h1>`,
    author ? `<p class="author">${escapeHtml(author)}</p>` : '',
    `<p class="meta">${metaParts.map((part) => escapeHtml(part)).join(' · ')}</p>`,
    `</header>`,
    renderToc(chapters, L),
    renderChapters(chapters, L),
    renderProse('connections', L.connections, connections),
    renderProse('overall', L.overallSummary, overallSummary),
    renderPeople(data.people, L),
    renderImages(images, L),
    renderNotes(chapters, data.notes, palette, L),
    renderQuiz(data.quiz, L),
    `</main>`,
  ]
    .filter(Boolean)
    .join('\n')

  return [
    `<!doctype html>`,
    `<html lang="${escapeHtml(lang)}">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(title)} · ${escapeHtml(L.docTitleSuffix)}</title>`,
    `<style>`,
    STYLE,
    `</style>`,
    `</head>`,
    `<body>`,
    body,
    `</body>`,
    `</html>`,
    ``,
  ].join('\n')
}
