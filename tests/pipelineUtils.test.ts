import { describe, it, expect, vi } from 'vitest'
import {
  CHAPTER_INPUT_MAX_CHARS,
  TRUNCATION_MARK,
  prepareChapterInput,
} from '../src/utils/chapterInput'
import { flattenMindMapToText } from '../src/utils/mindMapText'
import {
  createAbortError,
  createGenerationCounter,
  isAbortError,
  waitForSettled,
} from '../src/utils/runGuard'
import {
  clearChapterResult,
  hasFailedChapters,
  isPartialCache,
  markChapterFailed,
  toLoadedChapters,
  usableOrEmpty,
  usableSummaryChapters,
} from '../src/utils/chapterResults'
import { RESULT_PREFIX, failedText } from '../src/utils/resultStatus'

describe('prepareChapterInput', () => {
  it('未超限原样返回，空值返回空串', () => {
    expect(prepareChapterInput('abc')).toBe('abc')
    expect(prepareChapterInput(undefined)).toBe('')
    expect(prepareChapterInput(null)).toBe('')
  })

  it('超限截断并追加标记，单书与批量共用同一上限', () => {
    const long = 'x'.repeat(CHAPTER_INPUT_MAX_CHARS + 10)
    const out = prepareChapterInput(long)
    expect(out.length).toBe(CHAPTER_INPUT_MAX_CHARS + TRUNCATION_MARK.length)
    expect(out.endsWith(TRUNCATION_MARK)).toBe(true)
    expect(prepareChapterInput('abcdef', 3)).toBe('abc...')
    expect(prepareChapterInput('abcdef', 0)).toBe('abcdef')
  })
})

describe('flattenMindMapToText', () => {
  const mindMap = {
    nodeData: {
      topic: '第一章',
      children: [
        {
          topic: '要点 A',
          children: [
            { topic: 'A-1', children: [{ topic: '第三层不输出' }] },
            { topic: '  ' },
          ],
        },
        { topic: '要点 B' },
        null,
      ],
    },
  }

  it('输出根以下前 2 层，跳过根与更深层、空 topic', () => {
    expect(flattenMindMapToText(mindMap)).toBe('- 要点 A\n  - A-1\n- 要点 B')
  })

  it('depth 可配置；非法输入返回空串', () => {
    expect(flattenMindMapToText(mindMap, 1)).toBe('- 要点 A\n- 要点 B')
    expect(flattenMindMapToText(mindMap, 0)).toBe('')
    expect(flattenMindMapToText(null)).toBe('')
    expect(flattenMindMapToText({ nodeData: { topic: '只有根' } })).toBe('')
    expect(flattenMindMapToText('oops')).toBe('')
  })
})

describe('runGuard', () => {
  it('bump 后旧代失效', () => {
    const g = createGenerationCounter()
    const first = g.bump()
    expect(g.isCurrent(first)).toBe(true)
    const second = g.bump()
    expect(g.current).toBe(second)
    expect(g.isCurrent(first)).toBe(false)
  })

  it('AbortError 识别', () => {
    expect(isAbortError(createAbortError())).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })

  it('waitForSettled：结束（含 reject）返回 true，超时返回 false', async () => {
    expect(await waitForSettled(null, 10)).toBe(true)
    expect(await waitForSettled(Promise.resolve(1), 10)).toBe(true)
    expect(await waitForSettled(Promise.reject(new Error('x')), 10)).toBe(true)
    vi.useFakeTimers()
    try {
      const pending = waitForSettled(new Promise(() => {}), 100)
      await vi.advanceTimersByTimeAsync(100)
      expect(await pending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('chapterResults', () => {
  const ok = { id: '1', title: 'A', content: 'c', summary: '摘要', processed: true }
  const failed = markChapterFailed({ id: '2', title: 'B', content: 'c' }, new Error('超时'))
  const skipped = { id: '3', title: 'C', content: '', summary: `${RESULT_PREFIX.chapterSkipped}太短`, processed: true }

  it('失败章节 processed=false 且为失败占位', () => {
    expect(failed.processed).toBe(false)
    expect(failed.summary).toBe(`${RESULT_PREFIX.chapterFailed}超时`)
    expect(hasFailedChapters([ok, failed])).toBe(true)
    expect(hasFailedChapters([ok, skipped])).toBe(false)
  })

  it('只保留可用章节；失败占位文本视为空', () => {
    expect(usableSummaryChapters([ok, failed, skipped]).map((c) => c.id)).toEqual(['1'])
    expect(usableOrEmpty(failedText(RESULT_PREFIX.connectionsFailed, 'x'))).toBe('')
    expect(usableOrEmpty('关联')).toBe('关联')
    expect(usableOrEmpty(undefined)).toBe('')
  })

  it('isPartialCache：元数据或正文残留失败占位', () => {
    expect(isPartialCache({ chapters: [ok] })).toBe(false)
    expect(isPartialCache({ metadata: { isPartial: true }, chapters: [ok] })).toBe(true)
    expect(isPartialCache({ chapters: [ok, failed] })).toBe(true)
    expect(
      isPartialCache({ chapters: [ok], overallSummary: failedText(RESULT_PREFIX.overallFailed, 'x') })
    ).toBe(true)
    expect(isPartialCache({ metadata: null, chapters: [ok, skipped] })).toBe(false)
  })

  it('toLoadedChapters：占位章节标为未处理', () => {
    const loaded = toLoadedChapters(
      [
        { title: 'A', summary: '好' },
        { title: 'B', summary: failed.summary as string },
      ],
      'cloud'
    )
    expect(loaded.map((c) => [c.id, c.processed])).toEqual([
      ['cloud-0', true],
      ['cloud-1', false],
    ])
  })

  it('clearChapterResult 只改目标章，保留书级字段', () => {
    const book = {
      title: '书',
      author: '作者',
      charts: { version: 1 },
      chapters: [ok, { ...ok, id: '9', mindMap: { nodeData: { topic: 'x' } } as never }],
    }
    const cleared = clearChapterResult(book, '1', 'summary')
    expect(cleared.title).toBe('书')
    expect(cleared.charts).toBe(book.charts)
    expect(cleared.chapters[0]).toMatchObject({ summary: undefined, processed: false })
    expect(cleared.chapters[1]).toBe(book.chapters[1])

    const mm = clearChapterResult(book, '9', 'mindmap')
    expect(mm.chapters[1].mindMap).toBeUndefined()
    expect(mm.chapters[1].summary).toBe('摘要')

    expect(clearChapterResult(book, 'nope', 'summary')).toBe(book)
  })
})
