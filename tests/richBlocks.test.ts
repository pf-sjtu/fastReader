import { describe, it, expect } from 'vitest'
import { isRichLang, proseLength, richBlockCount, splitByFences, stripRichBlocks } from '@/lib/richBlocks'

const F = '```'

describe('stripRichBlocks / proseLength：富内容块不计字数', () => {
  const body = '企业像生命体一样经历阶段。\n\n每个阶段有不同的风险。'
  const mermaid = `${F}mermaid\ngraph LR\n  A[孕育期] --> B[婴儿期]\n${F}`

  it('三种围栏都被剔除，留下纯文字；字数只算文字', () => {
    const md = `${body}\n\n${mermaid}\n\n${F}genui\n{"type":"steps","items":[{"label":"甲"}]}\n${F}\n\n${F}html\n<div>很长的一段 html ${'x'.repeat(500)}</div>\n${F}\n\n尾段。`
    const out = stripRichBlocks(md)
    expect(out).not.toMatch(/mermaid|genui|graph LR|<div>/)
    expect(out).toContain('企业像生命体')
    expect(out).toContain('尾段。')
    expect(proseLength(md)).toBe(proseLength(`${body}\n\n尾段。`))
  })

  it('没有富内容块：原样（只规整多余空行）', () => {
    expect(stripRichBlocks(body)).toBe(body)
    expect(proseLength('')).toBe(0)
    expect(stripRichBlocks('')).toBe('')
  })

  it('普通代码块（非三种语言）不当作富内容块：它是正文的一部分，照常计字数', () => {
    const md = `说明：\n\n${F}python\nprint("hi")\n${F}\n`
    expect(stripRichBlocks(md)).toContain('print("hi")')
  })

  it('~~~ 围栏、更长的反引号围栏、围栏语言后带说明（info string）也认', () => {
    expect(stripRichBlocks(`正文\n\n~~~mermaid\ngraph TD\n~~~\n`)).not.toContain('graph')
    expect(stripRichBlocks(`正文\n\n${'`'.repeat(4)}html\n<p>含 ${F} 的内容</p>\n${'`'.repeat(4)}\n`)).not.toContain('<p>')
    expect(stripRichBlocks(`正文\n\n${F}mermaid title="x"\ngraph TD\n${F}\n`)).not.toContain('graph')
  })

  it('语言名大小写不敏感；html 内容里出现 ``` 不会提前结束（闭栏要同长或更长）', () => {
    expect(stripRichBlocks(`a\n\n${F}Mermaid\ngraph TD\n${F}\n`)).not.toContain('graph')
    const md = `前\n\n${'`'.repeat(4)}html\n<pre>${F}\ncode\n${F}</pre>\n${'`'.repeat(4)}\n\n后`
    expect(stripRichBlocks(md)).toMatch(/前\s+后/)
  })

  it('未闭合（输出被截断）：到文末都算块，不计字数，也不会把半截源码当正文', () => {
    const md = `${body}\n\n${F}mermaid\ngraph LR\n  A --> B\n  B --> `
    expect(stripRichBlocks(md).trim()).toBe(body)
    expect(proseLength(md)).toBe(body.length)
  })

  it('同一章多个块：全部剔除；richBlockCount 数得对（含未闭合的尾部）', () => {
    const md = `a\n\n${mermaid}\n\nb\n\n${F}genui\n{}\n${F}\n\nc\n\n${F}html\n<p>`
    expect(richBlockCount(md)).toBe(3)
    expect(stripRichBlocks(md).replace(/\s+/g, '')).toBe('abc')
    expect(richBlockCount('没有块')).toBe(0)
  })
})

describe('splitByFences：只对正文做处理', () => {
  it('偶数下标是正文、奇数下标是围栏块；拼回去等于原文', () => {
    const md = `前文 **a**\n\n${F}html\n<b>**x**</b>\n${F}\n\n后文 **b**`
    const parts = splitByFences(md)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain('前文')
    expect(parts[1]).toContain('<b>**x**</b>')
    expect(parts[2]).toContain('后文')
    expect(parts.join('')).toBe(md)
  })

  it('没有围栏：整段就是一个正文', () => {
    expect(splitByFences('只有正文')).toEqual(['只有正文'])
  })
})

describe('isRichLang', () => {
  it('只认三种，大小写不敏感', () => {
    expect(isRichLang('mermaid')).toBe(true)
    expect(isRichLang('GenUI')).toBe(true)
    expect(isRichLang('html')).toBe(true)
    expect(isRichLang('python')).toBe(false)
    expect(isRichLang(undefined)).toBe(false)
  })
})

describe('promptChapters：送进下游 prompt 的章节剔除富内容块', () => {
  it('剔除块、不改原对象；没有块的章节原样返回同一个对象；失败占位章节仍被排除', async () => {
    const { promptChapters } = await import('@/utils/chapterResults')
    const plain = { id: 'a', summary: '纯文字总结，没有任何图。' }
    const rich = { id: 'b', summary: `文字部分。\n\n${F}mermaid\ngraph LR\n  A --> B\n${F}\n\n结尾。` }
    const out = promptChapters([plain, rich, { id: 'c', summary: '' }])
    expect(out.map((c) => c.id)).toEqual(['a', 'b'])
    expect(out[0]).toBe(plain) // 没有块：同一个引用，零开销
    expect(out[1].summary).not.toContain('mermaid')
    expect(out[1].summary).toContain('文字部分。')
    expect(out[1].summary).toContain('结尾。')
    expect(rich.summary).toContain('mermaid') // 原对象不被修改（展示、云端上传仍要完整原文）
  })
})

// ---- 与 CLI（src/cli/rich_blocks.py 等）共享的契约夹具：两端必须给出完全相同的结果 ----
import cases from './fixtures/rich-blocks/cases.json'
import { listRichBlocks } from '@/lib/richBlocks'
import { parseGenUi } from '@/components/markdown/genui/schema'
import { diagnoseBlock } from '@/services/pipeline/richRepair'

describe('与 CLI 共享的契约夹具', () => {
  for (const c of cases.strip) {
    it(`strip：${c.name}`, () => {
      expect(stripRichBlocks(c.input)).toBe(c.prose)
      expect(proseLength(c.input)).toBe(c.prose.trim().length)
    })
  }
  for (const c of cases.list) {
    it(`list：${c.name}`, () => {
      expect(listRichBlocks(c.input).map((b) => ({ lang: b.lang, code: b.code, truncated: b.truncated }))).toEqual(c.blocks)
    })
  }
  for (const c of cases.genui) {
    it(`genui：${c.name}`, () => {
      const r = parseGenUi(c.code)
      expect(r.ok).toBe(c.ok)
      if (r.ok) expect(r.nodes.map((n) => n.type)).toEqual(c.types)
      else expect(r.error).toBe(c.error)
    })
  }
  for (const c of cases.diagnose) {
    it(`diagnose：${c.name}`, async () => {
      const got = await diagnoseBlock({ lang: c.lang as 'mermaid' | 'genui' | 'html', code: c.code, truncated: c.truncated }, { mermaid: async () => null })
      expect(got).toBe(c.error)
    })
  }
})
