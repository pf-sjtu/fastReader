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
    expect(isPlainTextBook(mkFile('download', 'x', 'text/markdown'))).toBe(true)
    expect(isPlainTextBook(mkFile('download', 'x', 'text/plain; charset=gbk'))).toBe(true)
  })

  it('text/html 之类的标签文本不算纯文本（按纯文本读出来是源码，不是书）', () => {
    expect(isPlainTextBook(mkFile('page', '<p>x</p>', 'text/html'))).toBe(false)
    expect(isPlainTextBook(mkFile('a.html', '<p>x</p>', 'text/html'))).toBe(false)
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

  it('GBK（GB18030）的中文 txt 不再整篇乱码', async () => {
    // 「中文。」的 GBK 字节不是合法 UTF-8，严格解码失败后才按 GB18030（GBK 超集）解
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xa1, 0xa3])
    const text = await readPlainText(new File([gbk], 'gbk.txt'))
    expect(text).toBe('中文。')
    expect(text).not.toContain('\uFFFD')
  })

  it('合法 UTF-8 里的 U+FFFD 占位符原样保留（不再按替换符密度猜编码）', async () => {
    // 书里出现「□」占位符是合法文本；旧逻辑会把它当编码坏了、整篇按 GB18030 重解成乱码
    const original = `${'\uFFFD'.repeat(10)}中文正文`
    const text = await readPlainText(mkFile('placeholder.txt', original))
    expect(text).toBe(original)
  })

  it('带 BOM 的 UTF-16 按 BOM 指定端序解（不猜 GBK）', async () => {
    const s = '第一行\n第二行'
    const bytes = new Uint8Array(2 + s.length * 2)
    bytes[0] = 0xff
    bytes[1] = 0xfe
    for (let i = 0; i < s.length; i += 1) {
      const code = s.charCodeAt(i)
      bytes[2 + i * 2] = code & 0xff
      bytes[2 + i * 2 + 1] = code >> 8
    }
    expect(await readPlainText(new File([bytes], 'utf16.txt'))).toBe(s)
  })

  it('坏字节落在两套编码都不合法处：退回 UTF-8 替换，好文本照常在', async () => {
    const good = '这是一段足够长的中文正文，坏字节只应影响它自己。'
    // 0xFF 既不是合法 UTF-8 也不是合法 GB18030（它不是 GB18030 的首字节），
    // 所以两条严格解码都失败，最后退回 UTF-8 的替换符结果——正文不会被猜坏
    const bytes = new Uint8Array([...new TextEncoder().encode(good), 0xff])
    const text = await readPlainText(new File([bytes], 'a.txt'))
    expect(text).toContain(good)
    expect(text).toBe(`${good}\uFFFD`)
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
