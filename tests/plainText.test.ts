import { describe, it, expect } from 'vitest'
import { isPlainTextBook } from '../src/utils/file'
import { plainBookTitle, readPlainText, splitPlainText } from '../src/services/pipeline/plainText'

const mkFile = (name: string, content: string, type = '') => new File([content], name, { type })

describe('isPlainTextBook', () => {
  it('认 .txt / .md / .markdown（大小写、全角点都认）', () => {
    expect(isPlainTextBook(mkFile('a.txt', 'x'))).toBe(true)
    expect(isPlainTextBook(mkFile('A.TXT', 'x'))).toBe(true)
    expect(isPlainTextBook(mkFile('笔记.md', 'x'))).toBe(true)
    expect(isPlainTextBook(mkFile('readme．MD', 'x'))).toBe(true)
    expect(isPlainTextBook(mkFile('notes.markdown', 'x'))).toBe(true)
  })

  it('MIME 说是文本也算（有些服务器不给扩展名）', () => {
    expect(isPlainTextBook(mkFile('download', 'x', 'text/plain'))).toBe(true)
  })

  it('epub / pdf / mobi 不是纯文本', () => {
    expect(isPlainTextBook(mkFile('a.epub', 'x'))).toBe(false)
    expect(isPlainTextBook(mkFile('a.pdf', 'x'))).toBe(false)
    expect(isPlainTextBook(mkFile('a.mobi', 'x'))).toBe(false)
    expect(isPlainTextBook(null)).toBe(false)
    expect(isPlainTextBook(undefined)).toBe(false)
  })
})

describe('plainBookTitle', () => {
  it('去掉扩展名；没有扩展名就原样', () => {
    expect(plainBookTitle('决策思维.txt')).toBe('决策思维')
    expect(plainBookTitle('/books/深奥的简洁.epub')).toBe('深奥的简洁')
    expect(plainBookTitle('没有扩展名')).toBe('没有扩展名')
    expect(plainBookTitle('.hidden')).toBe('.hidden')
  })
})

describe('readPlainText', () => {
  it('UTF-8 解码、去掉 BOM、CRLF 归一成 LF', async () => {
    expect(await readPlainText(mkFile('a.txt', '\uFEFF第一行\r\n第二行\r第三行'))).toBe('第一行\n第二行\n第三行')
  })
})

describe('splitPlainText', () => {
  it('没有标题：整篇一章，用兜底标题', () => {
    const chapters = splitPlainText('一段话。\n\n又一段。', '全文')
    expect(chapters).toEqual([{ id: '1', title: '全文', content: '一段话。\n\n又一段。' }])
  })

  it('markdown 按一二级标题切章，标题前的导语也算一章', () => {
    const md = ['导语一段。', '', '# 第一章', '', '正文一。', '', '## 第二节', '', '正文二。'].join('\n')
    expect(splitPlainText(md, '全书')).toEqual([
      { id: '1', title: '全书', content: '导语一段。' },
      { id: '2', title: '第一章', content: '正文一。' },
      { id: '3', title: '第二节', content: '正文二。' },
    ])
  })

  it('行尾的 # 与多余空格都去掉；三级标题不切章', () => {
    const md = ['## 标题 ##', '正文', '### 这是三级标题，不进标题', '还在同一章'].join('\n')
    expect(splitPlainText(md, 'f')).toEqual([
      { id: '1', title: '标题', content: '正文\n### 这是三级标题，不进标题\n还在同一章' },
    ])
  })

  it('空章节与连续标题不生成空章；只有标题时退回整篇一章', () => {
    expect(splitPlainText('# 一\n# 二\n正文', 'f')).toEqual([{ id: '1', title: '二', content: '正文' }])
    expect(splitPlainText('# 一\n\n# 二', 'f')).toEqual([{ id: '1', title: 'f', content: '# 一\n\n# 二' }])
  })

  it('章节序号从 1 连续编号', () => {
    const chapters = splitPlainText('# a\nx\n# b\ny\n# c\nz', 'f')
    expect(chapters.map((c) => c.id)).toEqual(['1', '2', '3'])
  })
})
