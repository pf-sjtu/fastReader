import { describe, it, expect } from 'vitest'
import {
  matchesDefaultUnselectTitle,
  matchesSkipChapterTitle,
} from '../src/services/constants'

describe('matchesDefaultUnselectTitle', () => {
  it('应对齐截图：前/后页素材默认不勾选', () => {
    expect(matchesDefaultUnselectTitle('作者／译者简介')).toBe(true)
    expect(matchesDefaultUnselectTitle('人物表')).toBe(true)
    expect(matchesDefaultUnselectTitle('致谢')).toBe(true)
    expect(matchesDefaultUnselectTitle('图片来源')).toBe(true)
    expect(matchesDefaultUnselectTitle('版权页')).toBe(true)
  })

  it('正文与序言/后记默认勾选（不匹配）', () => {
    expect(matchesDefaultUnselectTitle('序言 开始')).toBe(false)
    expect(matchesDefaultUnselectTitle('第一章 特雷')).toBe(false)
    expect(matchesDefaultUnselectTitle('第十四章 原始码')).toBe(false)
    expect(matchesDefaultUnselectTitle('后记')).toBe(false)
  })

  it('英文同类也应匹配', () => {
    expect(matchesDefaultUnselectTitle('Acknowledgments')).toBe(true)
    expect(matchesDefaultUnselectTitle('Copyright')).toBe(true)
    expect(matchesDefaultUnselectTitle('About the Author')).toBe(true)
  })
})

describe('matchesSkipChapterTitle', () => {
  it('与默认不勾选共享核心词表', () => {
    expect(matchesSkipChapterTitle('版权页')).toBe(true)
    expect(matchesSkipChapterTitle('第一章')).toBe(false)
  })
})
