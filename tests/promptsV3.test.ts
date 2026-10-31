import { describe, it, expect, vi } from 'vitest'
import cases from './fixtures/prompts-v3/meta-cases.json'
import {
  META_MARK,
  MAX_BOLD_PER_CHAPTER,
  buildEntityTable,
  checkSummaryQuality,
  joinChapterMeta,
  sanitizeSummary,
  splitChapterMeta,
  type ChapterMeta,
} from '@/services/prompts/chapterMeta'
import { DEFAULT_PROMPT_VERSION, loadPromptConfig, normalizePromptVersion } from '@/services/prompts/config/promptLoader'
import { renderPrompt } from '@/services/prompts/render'
import { runBookPipeline, type PipelineAI, type ChapterInput } from '@/services/pipeline/bookPipeline'

describe('chapterMeta：拆分（与 CLI 共用 tests/fixtures/prompts-v3/meta-cases.json）', () => {
  for (const c of cases.split) {
    it(c.name, () => {
      const r = splitChapterMeta(c.raw)
      expect(r.text).toBe(c.text)
      if (c.meta === null) expect(r.meta).toBeNull()
      else expect(r.meta).toMatchObject(c.meta)
    })
  }

  it('损坏的旁路给出诊断原因', () => {
    expect(splitChapterMeta('正文\n<!--juhua:meta-->\n{坏').metaError).toBeTruthy()
  })

  it('join 后再 split 往返一致（缓存里存的就是 join 的结果）', () => {
    const meta: ChapterMeta = { oneLine: '一句', takeaways: ['a'], entities: [{ name: 'X', aliases: ['x'] }], terms: [] }
    const r = splitChapterMeta(joinChapterMeta('正文', meta))
    expect(r.text).toBe('正文')
    expect(r.meta).toEqual(meta)
    expect(joinChapterMeta('正文', null)).toBe('正文')
  })
})

describe('chapterMeta：清理', () => {
  for (const c of cases.sanitize) it(c.name, () => expect(sanitizeSummary(c.input)).toBe(c.output))

  it(`加粗上限常量与规格一致（${MAX_BOLD_PER_CHAPTER}）`, () => expect(MAX_BOLD_PER_CHAPTER).toBe(6))
})

describe('chapterMeta：质量判定', () => {
  const long = '字'.repeat(300)
  it('按了 v3 格式（有旁路）、原文很长而正文极短 → tooShort；短原文不算', () => {
    expect(checkSummaryQuality('太短', 5000, { expectMeta: true, hasMeta: true })).toContain('tooShort')
    expect(checkSummaryQuality('太短', 300, { expectMeta: true, hasMeta: true })).toEqual([])
  })
  it('没有旁路的短输出不判「过短」（可能是「无需总结」/译文/自定义格式，不值得付费重写）', () => {
    expect(checkSummaryQuality('太短', 5000, { expectMeta: false, hasMeta: false })).toEqual([])
    expect(checkSummaryQuality('No summary needed.', 5000, { expectMeta: true, hasMeta: false })).toEqual(['noMeta'])
  })
  it('「无需总结」带引号/前缀字符也识别；缺旁路只在期望旁路时报 noMeta', () => {
    expect(checkSummaryQuality('「无需总结」', 5000, { expectMeta: true, hasMeta: true })).toEqual([])
    expect(checkSummaryQuality('"无需总结"', 5000, { expectMeta: true, hasMeta: true })).toEqual([])
    expect(checkSummaryQuality(long, 5000, { expectMeta: true, hasMeta: false })).toEqual(['noMeta'])
    expect(checkSummaryQuality(long, 5000, { expectMeta: false, hasMeta: false })).toEqual([])
  })
})

describe('实体表：缩写与全称归并', () => {
  it('第 3 章 KKR、第 9 章 Kohlberg Kravis Roberts（互为别名）→ 一个条目，别名并入', () => {
    const table = buildEntityTable([
      { oneLine: '', takeaways: [], terms: [], entities: [{ name: 'KKR', type: '机构', aliases: ['Kohlberg Kravis Roberts'] }] },
      null,
      { oneLine: '', takeaways: [], terms: [], entities: [{ name: 'Kohlberg Kravis Roberts', aliases: [] }, { name: '罗斯', aliases: [] }] },
    ])
    const lines = table.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('- KKR（机构）｜别名：Kohlberg Kravis Roberts')
    expect(lines[1]).toBe('- 罗斯')
  })
  it('出场章数多的排前；没有实体时为空串', () => {
    expect(buildEntityTable([])).toBe('')
    const m = (n: string): ChapterMeta => ({ oneLine: '', takeaways: [], terms: [], entities: [{ name: n, aliases: [] }] })
    expect(buildEntityTable([m('少'), m('多'), m('多')]).split('\n')[0]).toBe('- 多')
  })
})

describe('v3 提示词配置', () => {
  it('默认版本是 v3；v2 仍可加载；历史入参（v1）按 v2 处理', () => {
    expect(DEFAULT_PROMPT_VERSION).toBe('v3')
    expect(normalizePromptVersion('v1')).toBe('v2')
    expect(normalizePromptVersion('v3')).toBe('v3')
    expect(loadPromptConfig('v2').chapterSummary.nonFiction).not.toBe(loadPromptConfig('v3').chapterSummary.nonFiction)
  })

  it('v3 章节提示词要求旁路标记，去掉了「内心推理」与安抚话术', () => {
    for (const key of ['fiction', 'nonFiction'] as const) {
      const p = loadPromptConfig('v3').chapterSummary[key]
      expect(p).toContain(META_MARK)
      expect(p).not.toContain('内心')
      expect(p).not.toContain('请方向处理')
    }
  })

  it('v3 渲染后标题与正文各出现一次，没有残留占位符', () => {
    const out = renderPrompt(loadPromptConfig('v3').chapterSummary.nonFiction, [
      { name: 'title', label: '章节标题', value: 'TITLE_X' },
      { name: 'content', label: '章节内容', value: 'BODY_X' },
    ])
    expect(out.split('TITLE_X').length - 1).toBe(1)
    expect(out.split('BODY_X').length - 1).toBe(1)
    expect(out).not.toMatch(/\{\{\s*(title|content)\s*\}\}/)
  })

  it('除章节总结外，v3 沿用 v2 的其余提示词', () => {
    const [a, b] = [loadPromptConfig('v2'), loadPromptConfig('v3')]
    expect(b.mindmap).toEqual(a.mindmap)
    expect(b.connectionAnalysis).toBe(a.connectionAnalysis)
    expect(b.overallSummary).toBe(a.overallSummary)
  })
})

describe('流水线：旁路、清理、一次定向重写、实体表', () => {
  const chapters: ChapterInput[] = [1, 2].map((n) => ({ id: `c${n}`, title: `第${n}章`, content: '原文'.repeat(1200) }))
  const body = '这是足够长的章节总结正文。'.repeat(30)
  const meta = (n: string) => `\n\n${META_MARK}\n${JSON.stringify({ oneLine: '一句', takeaways: ['a'], entities: [{ name: n, aliases: [`${n}别名`] }], terms: [] })}`

  const makeAI = (summaries: string[]) => {
    const calls: Array<{ hint?: string }> = []
    const ai = {
      summarizeChapter: vi.fn(async (...args: unknown[]) => {
        const opts = args[5] as { rewriteHint?: string } | undefined
        calls.push({ hint: opts?.rewriteHint })
        return summaries.shift() ?? body
      }),
      analyzeConnections: vi.fn(async () => '关联分析结果，足够长。'.repeat(5)),
      generateOverallSummary: vi.fn(async () => '全书总结结果，足够长。'.repeat(5)),
      generateKeyCharts: vi.fn(async () => ({ version: 1 })),
      generateChapterMindMap: vi.fn(),
      generateCombinedMindMap: vi.fn(),
    } as unknown as PipelineAI
    return { ai, calls }
  }
  const run = (ai: PipelineAI, cache = null as never) =>
    runBookPipeline({ chapters, mode: 'summary', ai, bookTitle: '书', bookType: 'non-fiction', concurrency: 1, cache })

  it('章节：正文去掉旁路并清理格式，meta 挂到章节上', async () => {
    const { ai } = makeAI([`# 标题\n${body}***洞察***${meta('KKR')}`, body + meta('罗斯')])
    const r = await run(ai)
    expect(r.chapters[0].summary).not.toContain(META_MARK)
    expect(r.chapters[0].summary).not.toContain('# ')
    expect(r.chapters[0].summary).toContain('**洞察**')
    expect(r.chapters[0].meta?.entities[0].name).toBe('KKR')
    expect(r.chapters[0].quality).toBeUndefined()
  })

  it('书级步骤收到实体表（规范名 + 别名），章节间归并', async () => {
    const { ai } = makeAI([body + meta('KKR'), body + meta('罗斯')])
    await run(ai)
    const table = (ai.analyzeConnections as ReturnType<typeof vi.fn>).mock.calls[0][2].entityTable as string
    expect(table).toContain('- KKR｜别名：KKR别名')
    expect(table).toContain('- 罗斯｜别名：罗斯别名')
    expect((ai.generateKeyCharts as ReturnType<typeof vi.fn>).mock.calls[0][5].entityTable).toBe(table)
  })

  it('过短：恰好重写一次并带说明；重写合格则采用', async () => {
    const { ai, calls } = makeAI(['太短' + meta('A'), body + meta('A'), body + meta('B')])
    const r = await run(ai)
    expect(calls.filter((c) => c.hint).length).toBe(1)
    expect(calls[1].hint).toContain('字数不足')
    expect(r.chapters[0].summary.length).toBeGreaterThan(300)
    expect(r.chapters[0].quality).toBeUndefined()
  })

  it('重写后仍不合格：保留并标 warn，不再第二次重写', async () => {
    const { ai, calls } = makeAI(['太短' + meta('A'), '还是短' + meta('A'), body + meta('B')])
    const r = await run(ai)
    expect(calls.filter((c) => c.hint).length).toBe(1)
    expect(r.chapters[0].quality).toBe('warn')
  })

  it('没有旁路的短输出（如「无需总结」）：不付费重写', async () => {
    const { ai, calls } = makeAI(['无需总结', body + meta('B')])
    const r = await run(ai)
    expect(calls.every((c) => !c.hint)).toBe(true)
    expect(r.chapters[0].summary).toBe('无需总结')
  })

  it('重写抛错（429/网络）：保留首轮结果、标 warn，整章不判失败', async () => {
    let n = 0
    const { ai } = makeAI([])
    ;(ai.summarizeChapter as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      n++
      if ((args[5] as { rewriteHint?: string } | undefined)?.rewriteHint) throw new Error('429 Too Many Requests')
      return n === 1 ? '太短' + meta('A') : body + meta('B')
    })
    const r = await run(ai)
    expect(r.chapters[0].processed).toBe(true)
    expect(r.chapters[0].summary).toContain('太短')
    expect(r.chapters[0].quality).toBe('warn')
  })

  it('重写前先过限速（afterChapterAI 在重写之前再调一次）', async () => {
    const order: string[] = []
    const { ai } = makeAI([])
    ;(ai.summarizeChapter as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      const hinted = !!(args[5] as { rewriteHint?: string } | undefined)?.rewriteHint
      order.push(hinted ? 'call:rewrite' : 'call:first')
      return hinted ? body + meta('A') : '太短' + meta('A')
    })
    await runBookPipeline({
      chapters: [chapters[0]], mode: 'summary', ai, bookTitle: '书', bookType: 'non-fiction', concurrency: 1, cache: null as never,
      afterChapterAI: async () => void order.push('throttle'),
    })
    expect(order).toEqual(['call:first', 'throttle', 'call:rewrite', 'throttle'])
  })

  it('重写期间被取消：抛出取消，而不是吞掉', async () => {
    const ctrl = new AbortController()
    const { ai } = makeAI([])
    ;(ai.summarizeChapter as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      if ((args[5] as { rewriteHint?: string } | undefined)?.rewriteHint) {
        ctrl.abort()
        throw new DOMException('aborted', 'AbortError')
      }
      return '太短' + meta('A')
    })
    await expect(
      runBookPipeline({ chapters: [chapters[0]], mode: 'summary', ai, bookTitle: '书', bookType: 'non-fiction', concurrency: 1, cache: null as never, signal: ctrl.signal })
    ).rejects.toThrow()
  })

  it('自定义提示词：不清理（保留标题）、不判质量、不重写', async () => {
    const calls: unknown[] = []
    const { ai } = makeAI([])
    ;(ai.summarizeChapter as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      calls.push(args[5])
      return '# 我要的标题\n一句话。'
    })
    const r = await runBookPipeline({ chapters: [chapters[0]], mode: 'summary', ai, bookTitle: '书', bookType: 'non-fiction', concurrency: 1, cache: null as never, customPrompt: '一句话概括' })
    expect(calls).toHaveLength(1)
    expect(r.chapters[0].summary).toBe('# 我要的标题\n一句话。')
    expect(r.chapters[0].quality).toBeUndefined()
  })

  it('旁路缺失（模型没按格式）不触发重写，也不使该章失败', async () => {
    const { ai, calls } = makeAI([body, body])
    const r = await run(ai)
    expect(calls.every((c) => !c.hint)).toBe(true)
    expect(r.chapters[0].processed).toBe(true)
    expect(r.chapters[0].meta).toBeUndefined()
  })

  it('缓存存 join 结果：命中时恢复 meta，且不再调用 AI', async () => {
    const store = new Map<string, unknown>()
    const cache = {
      getChapter: async (_k: string, c: ChapterInput) => store.get(c.id) ?? null,
      setChapter: async (_k: string, c: ChapterInput, v: unknown) => void store.set(c.id, v),
      getBook: async () => null,
      setBook: async () => {},
    }
    const first = makeAI([body + meta('KKR'), body + meta('罗斯')])
    await run(first.ai, cache as never)
    const second = makeAI([])
    const r = await run(second.ai, cache as never)
    expect(second.ai.summarizeChapter).not.toHaveBeenCalled()
    expect(r.chapters[0].meta?.entities[0].name).toBe('KKR')
    expect(r.chapters[0].summary).not.toContain(META_MARK)
  })
})
