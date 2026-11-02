import { describe, it, expect } from 'vitest'
import {
  expandSelfClosingTags,
  findAnchor,
  fragmentToHtml,
  fragmentToText,
  isNavigationLike,
  parseSectionDoc,
  sliceSection,
} from '../../src/services/epub/sectionSlice'

const NS = 'http://www.w3.org/1999/xhtml'

/** Mobi 转 EPUB 的典型结构：空 span 锚点 + 紧随其后的标题段落 */
const mobiHtml = (xmlnsAttrs = `xmlns="${NS}"`) => `<?xml version="1.0" encoding="utf-8"?>
<html ${xmlnsAttrs}><head><title>t</title><style>p{color:red}</style></head><body>
<p>前言文字</p>
<span id="filepos0001"></span><p><span><b>第一章</b></span></p><p>第一章正文。</p>
<div><span id="filepos0002"></span><p><b>第二章</b></p><p>第二章正文。</p></div>
<span id="filepos0003"></span><p><b>第三章</b></p><p>第三章正文。</p>
<script>window.evil = 1</script>
</body></html>`

describe('sectionSlice', () => {
  describe('parseSectionDoc', () => {
    it('根元素重复 xmlns 时不整体失败，仍按 XHTML/HTML 正常解析', () => {
      const doc = parseSectionDoc(mobiHtml(`xmlns="${NS}" xmlns="${NS}"`))
      expect(doc.querySelector('parsererror')).toBeNull()
      expect(doc.body.textContent).toContain('第二章正文')
      expect(findAnchor(doc, 'filepos0002')).not.toBeNull()
    })

    it('剔除 script / style', () => {
      const doc = parseSectionDoc(mobiHtml())
      expect(doc.querySelector('script')).toBeNull()
      expect(doc.querySelector('style')).toBeNull()
    })

    it('XML 不合法的 HTML（自闭合 span）退到宽松解析，后续内容不被吞掉', () => {
      const doc = parseSectionDoc(
        `<html><body><span id="a"/><p>甲</p><span id="b"/><p>乙</p></body></html>`,
      )
      const { fragment } = sliceSection(doc, 'a', 'b')
      expect(fragmentToText(fragment)).toBe('甲')
    })
  })

  describe('expandSelfClosingTags', () => {
    it('非空元素展开，void 元素保持', () => {
      expect(expandSelfClosingTags('<span id="x"/><br/><img src="a.png"/>')).toBe(
        '<span id="x"></span><br/><img src="a.png"/>',
      )
    })
  })

  describe('findAnchor', () => {
    const doc = parseSectionDoc(
      `<html><body><p id="ch1">1</p><p id="ch10">10</p><a name="old"></a><p id="中文">中</p></body></html>`,
    )
    it('精确匹配，ch1 不会命中 ch10', () => {
      expect(findAnchor(doc, 'ch1')?.textContent).toBe('1')
      expect(findAnchor(doc, 'ch10')?.textContent).toBe('10')
      expect(findAnchor(doc, 'ch')).toBeNull()
    })
    it('兼容旧式 <a name> 与 URL 编码', () => {
      expect(findAnchor(doc, 'old')).not.toBeNull()
      expect(findAnchor(doc, encodeURIComponent('中文'))?.textContent).toBe('中')
    })
    it('缺省 / 不存在返回 null', () => {
      expect(findAnchor(doc, undefined)).toBeNull()
      expect(findAnchor(doc, 'nope')).toBeNull()
    })
  })

  describe('sliceSection', () => {
    const text = (anchor?: string, end?: string) => {
      const doc = parseSectionDoc(mobiHtml())
      return fragmentToText(sliceSection(doc, anchor, end).fragment)
    }

    it('空 span 锚点：只切 [起点, 终点)，不读到文件末尾', () => {
      const t = text('filepos0001', 'filepos0002')
      expect(t).toContain('第一章正文')
      expect(t).not.toContain('第二章')
      expect(t).not.toContain('前言文字')
    })

    it('终点嵌在别的容器里（div 内）也能按文档顺序截断', () => {
      const t = text('filepos0001', 'filepos0003')
      expect(t).toContain('第一章正文')
      expect(t).toContain('第二章正文')
      expect(t).not.toContain('第三章正文')
    })

    it('无终点：切到 body 末尾', () => {
      expect(text('filepos0003')).toContain('第三章正文')
    })

    it('无起点：从 body 开头起', () => {
      expect(text(undefined, 'filepos0001')).toBe('前言文字')
    })

    it('终点位于起点之前 / 终点在起点内部：忽略终点，不产出空区间', () => {
      expect(text('filepos0002', 'filepos0001')).toContain('第二章正文')
      const doc = parseSectionDoc(`<html><body><div id="s"><p>外</p><span id="e"></span><p>内</p></div></body></html>`)
      expect(fragmentToText(sliceSection(doc, 's', 'e').fragment)).toContain('内')
    })

    it('起点不存在：anchorMissing=true 并从头切', () => {
      const doc = parseSectionDoc(mobiHtml())
      const r = sliceSection(doc, 'missing')
      expect(r.anchorMissing).toBe(true)
      expect(fragmentToText(r.fragment)).toContain('前言文字')
    })
  })

  describe('fragmentToText / fragmentToHtml', () => {
    it('块级断行、行内折叠空白、br 换行', () => {
      const doc = parseSectionDoc(`<html><body><p>甲  乙</p><p>丙<br/>丁</p><span>戊</span><span>己</span></body></html>`)
      const { fragment } = sliceSection(doc)
      // 相邻段落之间留一个空行，br 是单个换行
      expect(fragmentToText(fragment)).toBe('甲 乙\n\n丙\n丁\n戊己')
    })

    it('fragmentToHtml 不消耗 fragment（之后仍可取文本）', () => {
      const doc = parseSectionDoc(`<html><body><p>内容</p></body></html>`)
      const { fragment } = sliceSection(doc)
      fragmentToHtml(doc, fragment)
      expect(fragmentToText(fragment)).toBe('内容')
    })

    it('fragmentToHtml 输出的 HTML 不含自闭合的非空元素', () => {
      const doc = parseSectionDoc(mobiHtml())
      const html = fragmentToHtml(doc, sliceSection(doc, 'filepos0001', 'filepos0002').fragment)
      expect(html).toContain('第一章正文')
      expect(html).not.toMatch(/<span[^>]*\/>/)
      expect(html).not.toContain('第二章')
    })
  })

  describe('isNavigationLike', () => {
    it('链接文字占主体的目录页为 true', () => {
      const links = Array.from({ length: 8 }, (_, i) => `<p><a href="#a${i}">第${i}章 标题</a></p>`).join('')
      expect(isNavigationLike(parseSectionDoc(`<html><body>${links}</body></html>`))).toBe(true)
    })
    it('正文页（少量链接）为 false', () => {
      const body = `<p>${'正文'.repeat(200)}<a href="#x">注</a></p>`
      expect(isNavigationLike(parseSectionDoc(`<html><body>${body}</body></html>`))).toBe(false)
    })
    it('空页为 false', () => {
      expect(isNavigationLike(parseSectionDoc(`<html><body></body></html>`))).toBe(false)
    })
  })
})
