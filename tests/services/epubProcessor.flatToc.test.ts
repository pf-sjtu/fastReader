import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
import { EpubProcessor } from '../../src/services/epubProcessor'

/**
 * 扁平目录还原（epub-toc）的端到端回归，真实 epubjs。
 * 目录形态来自 RR 书库的真实问题：Mobi 转 EPUB 的 NCX 把「篇 / 章 / 节」摊平在同一层，
 * 旧行为是一条目录一章（几十~上百章），「目录层级」选项形同虚设。
 */

const NS = 'http://www.w3.org/1999/xhtml'
const body = (label: string) => `${label}的正文内容，`.repeat(30)

interface Entry {
  id: string
  title: string
  /** 页面里该标题之后的正文标记 */
  mark: string
}

async function buildEpub(entries: Entry[]): Promise<File> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  zip.file(
    'content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>扁平目录</dc:title><dc:creator>某人</dc:creator><dc:language>zh</dc:language><dc:identifier id="uid">flat-toc</dc:identifier></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="t0" href="text.html" media-type="application/xhtml+xml"/></manifest>
<spine toc="ncx"><itemref idref="t0"/></spine>
</package>`,
  )
  const navPoints = entries
    .map(
      (e, i) =>
        `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${e.title}</text></navLabel><content src="text.html#${e.id}"/></navPoint>`,
    )
    .join('')
  zip.file(
    'toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>t</text></docTitle><navMap>${navPoints}</navMap></ncx>`,
  )
  const html = entries
    .map((e) => `<span id="${e.id}"></span><p><b>${e.title}</b></p><p>${body(e.mark)}</p>`)
    .join('')
  zip.file('text.html', `<?xml version="1.0" encoding="utf-8"?><html xmlns="${NS}"><head><title>t</title></head><body>${html}</body></html>`)

  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return {
    name: 'flat-toc.epub',
    size: buf.byteLength,
    type: 'application/epub+zip',
    lastModified: Date.now(),
    arrayBuffer: async () => buf.slice(0),
  } as File
}

/** 上篇 / 第一章(2 节) / 第二章(2 节) / 下篇 / 第三章(2 节)，共 11 条，全部同一层 */
function numberedEntries(): Entry[] {
  const e: Entry[] = []
  const add = (title: string, mark: string) => e.push({ id: `filepos${String(e.length).padStart(4, '0')}`, title, mark })
  add('上篇 起点', 'P1')
  add('第一章 缘起', 'C1')
  add('1.甲节', 'S11')
  add('2.乙节', 'S12')
  add('第二章 发展', 'C2')
  add('1.丙节', 'S21')
  add('2.丁节', 'S22')
  add('下篇 终点', 'P2')
  add('第三章 结局', 'C3')
  add('1.戊节', 'S31')
  add('2.己节', 'S32')
  return e
}

const extract = (p: EpubProcessor, file: File, depth: number) =>
  p.extractBookData(file, false, true, 0, 'auto', 'epub-toc', depth).then((d) => d.chapters)

describe('EpubProcessor：扁平目录还原（算法）', () => {
  it('第1级 = 章：3 章，每章含自己的节，不吞下一部的扉页', async () => {
    const file = await buildEpub(numberedEntries())
    const chapters = await extract(new EpubProcessor(), file, 1)

    expect(chapters.map((c) => c.title.replace(/^\s*(第\d+章\s*[-—:：]?\s*)?/, ''))).toHaveLength(3)
    const [c1, c2, c3] = chapters
    expect(c1.content).toContain('C1的正文内容')
    expect(c1.content).toContain('S11的正文内容')
    expect(c1.content).toContain('S12的正文内容')
    expect(c1.content).not.toContain('C2的正文内容')

    expect(c2.content).toContain('S22的正文内容')
    // 第二章后面是「下篇」：边界节点截断，扉页不能算进第二章
    expect(c2.content).not.toContain('P2的正文内容')
    expect(c2.content).not.toContain('C3的正文内容')

    expect(c3.content).toContain('S32的正文内容')
    expect(c3.content).not.toContain('S22的正文内容')
  }, 60_000)

  it('第2级 = 节：6 节，各自独立', async () => {
    const file = await buildEpub(numberedEntries())
    const chapters = await extract(new EpubProcessor(), file, 2)
    expect(chapters).toHaveLength(6)
    const jia = chapters.find((c) => /甲节/.test(c.title))!
    expect(jia.content).toContain('S11的正文内容')
    expect(jia.content).not.toContain('S12的正文内容')
  }, 60_000)

  it('第2级：每章最后一节在章 / 篇边界截止，不吞下一章与下一部', async () => {
    const file = await buildEpub(numberedEntries())
    const chapters = await extract(new EpubProcessor(), file, 2)
    const ding = chapters.find((c) => /丁节/.test(c.title))! // 第二章最后一节，其后是「下篇」
    expect(ding.content).toContain('S22的正文内容')
    expect(ding.content).not.toContain('P2的正文内容')
    expect(ding.content).not.toContain('C3的正文内容')
    const yi = chapters.find((c) => /乙节/.test(c.title))! // 第一章最后一节，其后是第二章
    expect(yi.content).not.toContain('C2的正文内容')
    // id 按输出序号连续编号
    expect(chapters.map((c) => c.id)).toEqual(['chapter-1', 'chapter-2', 'chapter-3', 'chapter-4', 'chapter-5', 'chapter-6'])
  }, 60_000)

  it('关闭还原：回到旧行为，每条目录一章（篇的扉页也算）', async () => {
    const file = await buildEpub(numberedEntries())
    const processor = new EpubProcessor()
    processor.configureTocRestructure({ enabled: false })
    const chapters = await extract(processor, file, 1)
    expect(chapters.length).toBe(11)
  }, 60_000)

  it('算法有把握时不调用 LLM', async () => {
    const file = await buildEpub(numberedEntries())
    const resolveLevels = vi.fn(async () => null)
    const processor = new EpubProcessor()
    processor.configureTocRestructure({ enabled: true, resolveLevels })
    await extract(processor, file, 1)
    expect(resolveLevels).not.toHaveBeenCalled()
  }, 60_000)
})

/** 完全没有编号的长目录：6 个「章」各带 4 个小标题，共 30 条——只有 LLM 能判 */
function unnumberedEntries(): Entry[] {
  const e: Entry[] = []
  const add = (title: string, mark: string) => e.push({ id: `a${e.length}`, title, mark })
  for (let c = 0; c < 6; c++) {
    add(`主题${c}`, `T${c}`)
    for (let s = 0; s < 4; s++) add(`话题${c}-${s}`, `Q${c}${s}`)
  }
  return e
}

describe('EpubProcessor：扁平目录还原（LLM 兜底）', () => {
  const levelsFor = (entries: Entry[]) => entries.map((e) => (e.title.startsWith('主题') ? 1 : 2))

  it('算法拿不准的书请 resolveLevels 判层级，再按原锚点切区间', async () => {
    const entries = unnumberedEntries()
    const file = await buildEpub(entries)
    const resolveLevels = vi.fn(async (labels: string[]) => {
      expect(labels).toEqual(entries.map((e) => e.title))
      return levelsFor(entries)
    })
    const processor = new EpubProcessor()
    processor.configureTocRestructure({ enabled: true, resolveLevels })

    const chapters = await extract(processor, file, 1)
    expect(resolveLevels).toHaveBeenCalledTimes(1)
    expect(chapters).toHaveLength(6)
    expect(chapters[0].content).toContain('T0的正文内容')
    expect(chapters[0].content).toContain('Q03的正文内容')
    expect(chapters[0].content).not.toContain('T1的正文内容')
  }, 60_000)

  it('LLM 报错 / 返回 null：保持扁平，不阻断提取', async () => {
    const entries = unnumberedEntries()
    const file = await buildEpub(entries)

    const failing = new EpubProcessor()
    failing.configureTocRestructure({
      enabled: true,
      resolveLevels: async () => {
        throw new Error('boom')
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await extract(failing, file, 1)).length).toBe(entries.length)
    warn.mockRestore()

    const declined = new EpubProcessor()
    declined.configureTocRestructure({ enabled: true, resolveLevels: async () => null })
    expect((await extract(declined, file, 1)).length).toBe(entries.length)
  }, 60_000)

  it('取消（AbortError）向上抛，不被当成普通失败吞掉', async () => {
    const file = await buildEpub(unnumberedEntries())
    const processor = new EpubProcessor()
    processor.configureTocRestructure({
      enabled: true,
      resolveLevels: async () => {
        throw new DOMException('Aborted', 'AbortError')
      },
    })
    await expect(extract(processor, file, 1)).rejects.toMatchObject({ name: 'AbortError' })
  }, 60_000)
})
