/**
 * 学习包数据收集：把界面已经拿到的书 / 笔记 / 自测 / 实体数据搬成 `PackData`。
 *
 * 这一层刻意做成**纯粹的搬运与过滤**：不读 window、不读 store、不读文件、不发请求、不看时钟
 * （当前时间由 `now` 注入）。理由有两个：
 * - 接线归 Lead 的 UI 层，这里不该知道数据从哪个 store 来；
 * - 纯函数可以直接单测，离线包的字段正确性不必靠界面点一遍来验证。
 *
 * 过滤规则只有「明知展示不了的东西才丢」：空原文片段的笔记、空题面。其余一律原样带过，
 * 宁可包里多一条空段落，也不要静默少一条用户写过的笔记。
 */
import type { PackChapter, PackData, PackImage, PackNote, PackPerson, PackQuizItem } from './buildPack'

export interface CollectBookInput {
  title: string
  author?: string
  chapters: readonly { title: string; summary?: string }[]
}

export interface CollectNoteInput {
  chapterTitle: string
  quote: string
  comment: string
  color: 1 | 2 | 3 | 4
}

export interface CollectQuestionInput {
  question: string
  options: string[]
  answerIndex: number
  explanation?: string
}

/** 与 `src/study/persistence.ts` 的 `AnsweredQuestion` 对应：`picked` 在这里叫 `chosen` */
export interface CollectAnswerInput {
  correct: boolean
  chosen?: number
}

export interface CollectStudyInput {
  quiz?: { questions: CollectQuestionInput[] } | null
  /**
   * 键是**题目 id**，即 `src/study/schema.ts` 的 `parseQuiz` 生成的 `q1`、`q2`…
   * （按题目在该数组中的顺序编号，所以第 i 题读 `q${i + 1}`）。
   */
  answers?: Record<string, CollectAnswerInput>
}

export interface CollectPackInput {
  book: CollectBookInput
  connections?: string
  overallSummary?: string
  notes: readonly CollectNoteInput[]
  study?: CollectStudyInput | null
  people?: PackPerson[]
  images?: PackImage[]
  /** 生成时间；不传则取当前时刻（注入是为了可测） */
  now?: number
}

/**
 * 自测题：题目顺序即 id 顺序（`q1`…），据此把作答记录贴回对应题目。
 * `correct` 不参与生成——`PackQuizItem` 里「选了第几项」和「正确答案是第几项」已经足以表达对错，
 * 多存一份状态反而可能和真实作答不一致（简答题没有 `chosen`，这里也就自然没有标记）。
 */
function collectQuiz(study: CollectStudyInput | null | undefined): PackQuizItem[] | null {
  const questions = study?.quiz?.questions
  if (!questions?.length) return null
  const answers = study?.answers ?? {}
  const items: PackQuizItem[] = []
  questions.forEach((question, i) => {
    const answered = answers[`q${i + 1}`]
    const explanation = question.explanation?.trim()
    const chosen = typeof answered?.chosen === 'number' ? answered.chosen : undefined
    items.push({
      question: question.question,
      options: [...question.options],
      answerIndex: question.answerIndex,
      ...(explanation ? { explanation } : {}),
      ...(chosen === undefined ? {} : { chosen }),
    })
  })
  return items.length ? items : null
}

/** 收集学习包数据。`chapters` 的下标按数组顺序重编号，`index` 是排序依据 */
export function collectPackData(input: CollectPackInput): PackData {
  const chapters: PackChapter[] = input.book.chapters.map((chapter, index) => ({
    index,
    title: chapter.title,
    summary: (chapter.summary ?? '').trim(),
  }))

  const notes: PackNote[] = []
  for (const note of input.notes) {
    const quote = note.quote.trim()
    if (!quote) continue
    notes.push({
      chapterTitle: note.chapterTitle.trim(),
      quote,
      comment: note.comment.trim(),
      // 存档可能来自旧版本或被改坏，颜色收敛到 1..4
      color: note.color === 2 || note.color === 3 || note.color === 4 ? note.color : 1,
    })
  }

  const connections = input.connections?.trim()
  const overallSummary = input.overallSummary?.trim()
  const author = input.book.author?.trim()
  const people = input.people?.length ? input.people : undefined
  const images = input.images?.length ? input.images : undefined

  // 可选块只在真有内容时才带上键：`in` 能看到 `author: undefined` 这种键，
  // 消费方（比如把 PackData 当 JSON 传出去）不需要为「键在但值是空」分支
  return {
    title: input.book.title.trim(),
    ...(author ? { author } : {}),
    generatedAt: input.now ?? Date.now(),
    chapters,
    ...(connections ? { connections } : {}),
    ...(overallSummary ? { overallSummary } : {}),
    notes,
    quiz: collectQuiz(input.study),
    ...(people ? { people } : {}),
    ...(images ? { images } : {}),
  }
}
