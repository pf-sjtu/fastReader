import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bookIdOf, bookStem, normalizeStem } from '../src/services/library/bookId'
import { buildNormIndex, dice, matchCoverId, type CoverIndex } from '../src/services/library/cloudCovers'

const CASES = JSON.parse(readFileSync('tests/fixtures/book-id-cases.json', 'utf-8')) as { name: string; id: string; normalized: string }[]

describe('bookId：与预处理脚本逐字节等价（共用 tests/fixtures/book-id-cases.json）', () => {
  it.each(CASES.map((c) => [c.name || '(空)', c] as const))('%s', (_n, c) => {
    expect(bookIdOf(c.name)).toBe(c.id)
    expect(normalizeStem(bookStem(c.name))).toBe(c.normalized)
  })
  it('同一本书换标点 / 全半角 / 扩展名 / 目录，id 不变；不同书不同', () => {
    expect(bookIdOf('/a/“错误”的行为：行为经济学的形成 - 理查德·塞勒.epub')).toBe(bookIdOf('"错误"的行为:行为经济学的形成 - 理查德・塞勒.pdf'))
    expect(bookIdOf('甲.epub')).not.toBe(bookIdOf('乙.epub'))
    expect(bookIdOf('a.epub')).toMatch(/^bk_[0-9a-z]{6,16}$/)
  })
})

const item = (stem: string) => ({ stem, title: stem, cover: 1 as const })
const index: CoverIndex = {
  [bookIdOf('经济学原理（第7版） - 曼昆.epub')]: item('经济学原理（第7版） - 曼昆'),
  [bookIdOf('贫穷的本质 - 阿比吉特·班纳吉.epub')]: item('贫穷的本质 - 阿比吉特·班纳吉'),
  [bookIdOf('穷查理宝典 - 彼得·考夫曼.epub')]: item('穷查理宝典 - 彼得·考夫曼'),
  [bookIdOf('穷查理宝典（珍藏版） - 彼得·考夫曼.epub')]: item('穷查理宝典（珍藏版） - 彼得·考夫曼'),
}

describe('matchCoverId：精确 → 模糊，宁缺毋错', () => {
  it('同名（忽略标点 / 扩展名）精确命中', () => {
    expect(matchCoverId('/s/经济学原理(第7版)-曼昆.pdf', index)).toBe(bookIdOf('经济学原理（第7版） - 曼昆.epub'))
  })
  it('名字只多了个后缀（如「修订版」）时模糊命中唯一最佳；差异太大（少了作者全名）不配', () => {
    expect(matchCoverId('/s/贫穷的本质 - 阿比吉特·班纳吉（修订版）.epub', index)).toBe(bookIdOf('贫穷的本质 - 阿比吉特·班纳吉.epub'))
    expect(matchCoverId('/s/贫穷的本质 - 班纳吉.epub', index)).toBeNull()
  })
  it('有两本都很像（歧义）→ 不配', () => {
    expect(matchCoverId('/s/穷查理宝典 - 考夫曼（修订）.epub', index)).toBeNull()
  })
  it('两本分卷书都同样像（差一个字）→ 不配，而不是随手贴一本', () => {
    const vol = (n: string) => `资本论政治经济学批判马克思恩格斯全集中文版人民出版社第${n}卷.epub`
    const idx: CoverIndex = { [bookIdOf(vol('一'))]: item(vol('一').replace('.epub', '')), [bookIdOf(vol('二'))]: item(vol('二').replace('.epub', '')) }
    expect(matchCoverId(`/s/${vol('三')}`, idx)).toBeNull()
    expect(matchCoverId(`/s/${vol('二')}`, idx)).toBe(bookIdOf(vol('二'))) // 精确的仍然命中
  })
  it('完全不相干 / 名字太短 → null', () => {
    expect(matchCoverId('/s/一本完全不同的书.epub', index)).toBeNull()
    expect(matchCoverId('/s/a.epub', index)).toBeNull()
    expect(matchCoverId('/s/x.epub', {})).toBeNull()
  })
  it('dice：相同 1、无交集 0、短串 0；buildNormIndex 预归一', () => {
    expect(dice('abcd', 'abcd')).toBe(1)
    expect(dice('abcd', 'wxyz')).toBe(0)
    expect(dice('a', 'ab')).toBe(0)
    expect([...buildNormIndex(index).values()][0]).toBe(normalizeStem('经济学原理（第7版） - 曼昆'))
  })
})
