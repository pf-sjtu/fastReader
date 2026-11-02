import { describe, it, expect, beforeAll } from 'vitest'
import JSZip from 'jszip'
import { EpubProcessor } from '../../src/services/epubProcessor'

/**
 * Mobi 转 EPUB 的回归测试（用真实 epubjs，不 mock）。
 * 复刻《大国大城》的结构：
 * - 少量 spine 文件，扁平 NCX，href 形如 `text00000.html#filepos…`
 * - 锚点是**空 span**，标题在其后继兄弟里
 * - 第一个文件开头有 CIP 版权页和一页带链接的目录页
 * 旧实现的症状：每章都从锚点读到文件末尾（字数递减）；阅读面板永远从文件开头（CIP 页）显示。
 */

const NS = 'http://www.w3.org/1999/xhtml'
const para = (label: string) => `${label}的正文内容，`.repeat(30)

const page = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="${NS}"><head><title>t</title></head><body>${body}</body></html>`

const chapter = (id: string, title: string) =>
  `<span id="${id}"></span><p><span><b>${title}</b></span></p><p>${para(title)}</p>`

const TOC = [
  { id: 'filepos0000000100', title: '第一章 开始', file: 'text00000.html' },
  { id: 'filepos0000000200', title: '1.甲节', file: 'text00000.html' },
  { id: 'filepos0000000300', title: '2.乙节', file: 'text00000.html' },
  { id: 'filepos0000000400', title: '3.丙节', file: 'text00001.html' },
  { id: 'filepos0000000500', title: '4.丁节', file: 'text00001.html' },
]

async function buildMobiStyleEpub(): Promise<File> {
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
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成书</dc:title><dc:creator>某人</dc:creator><dc:language>zh</dc:language><dc:identifier id="uid">mobi-test</dc:identifier></metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="t0" href="text00000.html" media-type="application/xhtml+xml"/>
<item id="t1" href="text00001.html" media-type="application/xhtml+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="t0"/><itemref idref="t1"/></spine>
</package>`,
  )
  const navPoints = TOC.map(
    (t, i) =>
      `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${t.title}</text></navLabel><content src="${t.file}#${t.id}"/></navPoint>`,
  ).join('')
  zip.file(
    'toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>合成书</text></docTitle><navMap>${navPoints}</navMap></ncx>`,
  )

  // text00000：CIP 页 + 链接目录页 + 第一章（标题页）+ 1.甲节 + 2.乙节
  const cip = `<p><b>图书在版编目（CIP）数据</b></p><p>ISBN 978-7-000-00000-0 出版社 版权所有 翻印必究</p>`
  const tocPage = TOC.map((t) => `<p><a href="${t.file}#${t.id}">${t.title}</a></p>`).join('')
  zip.file(
    'text00000.html',
    page(
      cip +
        tocPage +
        chapter(TOC[0].id, TOC[0].title) +
        chapter(TOC[1].id, TOC[1].title) +
        chapter(TOC[2].id, TOC[2].title),
    ),
  )
  // text00001：3.丙节 + 4.丁节
  zip.file('text00001.html', page(chapter(TOC[3].id, TOC[3].title) + chapter(TOC[4].id, TOC[4].title)))

  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return {
    name: 'mobi-style.epub',
    size: buf.byteLength,
    type: 'application/epub+zip',
    lastModified: Date.now(),
    arrayBuffer: async () => buf.slice(0),
  } as File
}

describe('EpubProcessor：Mobi 风格空 span 锚点（epub-toc）', () => {
  let file: File
  beforeAll(async () => {
    file = await buildMobiStyleEpub()
  })

  it('每章只含自己的正文，不会读到文件末尾', async () => {
    const processor = new EpubProcessor()
    const data = await processor.extractBookData(file, false, true, 0, 'auto', 'epub-toc', 1)
    const byTitle = (re: RegExp) => data.chapters.find((c) => re.test(c.title))!

    const jia = byTitle(/甲节/)
    const yi = byTitle(/乙节/)
    const bing = byTitle(/丙节/)
    const ding = byTitle(/丁节/)
    for (const c of [jia, yi, bing, ding]) expect(c, '章节应被识别').toBeTruthy()

    // 同一文件内：甲节只到乙节锚点为止
    expect(jia.content).toContain('甲节的正文内容')
    expect(jia.content).not.toContain('乙节的正文内容')
    // 跨文件边界：乙节到下一目录项（text00001 的丙节）之前，不会把丙/丁吞进来
    expect(yi.content).toContain('乙节的正文内容')
    expect(yi.content).not.toContain('丙节的正文内容')
    // 最后一章切到文件末尾，但不含上一章
    expect(ding.content).toContain('丁节的正文内容')
    expect(ding.content).not.toContain('丙节的正文内容')
    expect(bing.content).not.toContain('丁节的正文内容')
  }, 60_000)

  it('章节内容不含 CIP 版权页与链接目录页', async () => {
    const processor = new EpubProcessor()
    const data = await processor.extractBookData(file, false, true, 0, 'auto', 'epub-toc', 1)
    for (const c of data.chapters) {
      expect(c.content).not.toContain('图书在版编目')
      expect(c.content).not.toContain('ISBN')
    }
  }, 60_000)

  it('章节携带 endAnchor / endSpineIndex，阅读面板据此渲染同一区间', async () => {
    const processor = new EpubProcessor()
    const data = await processor.extractBookData(file, false, true, 0, 'auto', 'epub-toc', 1)
    const jia = data.chapters.find((c) => /甲节/.test(c.title))!
    expect(jia.href).toContain('filepos0000000200')
    expect(jia.endAnchor).toBe('filepos0000000300')
  }, 60_000)

  it('getChapterHTML：从本章锚点开始，不是文件开头（不再显示 CIP 页）', async () => {
    const processor = new EpubProcessor()
    const data = await processor.extractBookData(file, false, true, 0, 'auto', 'epub-toc', 1)
    // extractBookData 内部会释放 Book，这里重新打开一份用于渲染
    const book = (await processor.parseEpub(file)).book
    try {
      const jia = data.chapters.find((c) => /甲节/.test(c.title))!
      const html = await processor.getChapterHTML(book, jia)
      expect(html).toContain('甲节的正文内容')
      expect(html).not.toContain('图书在版编目')
      expect(html).not.toContain('乙节的正文内容')
      expect(html).not.toMatch(/<span[^>]*\/>/)
    } finally {
      processor.destroy?.()
    }
  }, 60_000)
})
