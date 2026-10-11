import { describe, it, expect } from 'vitest'
import {
  RESULT_PREFIX,
  failedText,
  isFailedText,
  isPlaceholderText,
  isUsableText,
} from '../src/utils/resultStatus'

describe('resultStatus', () => {
  it('failedText 拼接前缀与错误信息', () => {
    expect(failedText(RESULT_PREFIX.chapterFailed, new Error('429'))).toBe('【处理失败】429')
    expect(failedText(RESULT_PREFIX.overallFailed, 'boom')).toBe('【全书总结失败】boom')
    expect(failedText(RESULT_PREFIX.chapterFailed, undefined)).toBe('【处理失败】未知错误')
  })

  it('区分失败与跳过占位', () => {
    const failed = failedText(RESULT_PREFIX.connectionsFailed, new Error('x'))
    const skipped = `${RESULT_PREFIX.chapterSkipped}内容过短`
    expect(isFailedText(failed)).toBe(true)
    expect(isFailedText(skipped)).toBe(false)
    expect(isPlaceholderText(failed)).toBe(true)
    expect(isPlaceholderText(skipped)).toBe(true)
  })

  it('isUsableText 排除空白、占位与空值', () => {
    expect(isUsableText('正常摘要')).toBe(true)
    expect(isUsableText('   ')).toBe(false)
    expect(isUsableText('')).toBe(false)
    expect(isUsableText(null)).toBe(false)
    expect(isUsableText(undefined)).toBe(false)
    expect(isUsableText('【处理失败】超时')).toBe(false)
    expect(isPlaceholderText(null)).toBe(false)
    expect(isFailedText(undefined)).toBe(false)
  })
})
