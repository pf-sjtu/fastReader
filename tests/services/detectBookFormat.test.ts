import { describe, it, expect } from 'vitest'
import { detectBookFormat } from '../../src/utils/file'

function fakeFile(name: string, type = ''): File {
  return { name, type } as File
}

describe('detectBookFormat', () => {
  it('识别 epub/pdf 扩展名', () => {
    expect(detectBookFormat(fakeFile('a.epub'))).toBe('epub')
    expect(detectBookFormat(fakeFile('B.PDF'))).toBe('pdf')
  })

  it('识别全角点与 MIME', () => {
    expect(detectBookFormat(fakeFile('书．epub'))).toBe('epub')
    expect(detectBookFormat(fakeFile('x', 'application/epub+zip'))).toBe('epub')
    expect(detectBookFormat(fakeFile('x', 'application/pdf'))).toBe('pdf')
  })

  it('拒绝 md/空名', () => {
    expect(detectBookFormat(fakeFile('完整摘要.md'))).toBe(null)
    expect(detectBookFormat(fakeFile(''))).toBe(null)
  })
})
