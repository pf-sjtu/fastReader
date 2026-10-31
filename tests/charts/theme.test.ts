import { describe, it, expect, vi } from 'vitest'
import { cssColorToHex } from '@/charts/theme'

describe('cssColorToHex', () => {
  it('保留合法 hex', () => {
    expect(cssColorToHex('#4a433c')).toBe('#4a433c')
    expect(cssColorToHex('#abc')).toBe('#aabbcc')
  })

  it('空值回退', () => {
    expect(cssColorToHex('', '#123456')).toBe('#123456')
  })

  it('解析 rgb()', () => {
    // jsdom 对 oklch 支持有限；rgb 必过
    if (typeof document === 'undefined') return
    const hex = cssColorToHex('rgb(74, 67, 60)', '#000000')
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(hex).toBe('#4a433c')
  })
})

describe('cssColorToHex：canvas 路径（现代浏览器里 oklch 的 computed 值不是 rgb()）', () => {
  /** 伪造 2D 上下文：fillStyle 赋值后 fillRect，getImageData 返回注入的像素 */
  function stubCanvas(pixel: [number, number, number, number] | ((css: string) => [number, number, number, number])) {
    let css = ''
    const ctx = {
      set fillStyle(v: string) {
        css = v
      },
      get fillStyle() {
        return css
      },
      clearRect: () => {},
      fillRect: () => {},
      getImageData: () => ({ data: typeof pixel === 'function' ? pixel(css) : pixel }),
    }
    return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  }

  it('oklch 经 canvas 读回 sRGB', () => {
    // 模块级缓存了探针上下文：用 resetModules 保证每个用例拿到新的 stub
    vi.resetModules()
    const spy = stubCanvas([240, 116, 86, 255])
    return import('@/charts/theme').then(({ cssColorToHex: f }) => {
      expect(f('oklch(0.7 0.16 35)')).toBe('#f07456')
      spy.mockRestore()
    })
  })

  it('非法颜色（像素仍是哨兵值）→ 不误读', () => {
    vi.resetModules()
    const spy = stubCanvas([1, 2, 3, 255])
    return import('@/charts/theme').then(({ cssColorToHex: f }) => {
      // canvas 路径应判为无效并交还给 DOM 解析，绝不能把哨兵像素 #010203 当成结果
      expect(f('not-a-color', '#123456')).not.toBe('#010203')
      spy.mockRestore()
    })
  })
})

describe('readableTextOn', () => {
  it('浅底配深字、深底配浅字', async () => {
    const { readableTextOn } = await import('@/charts/theme')
    expect(readableTextOn('#f0e6d2')).toBe('#1f1a16')
    expect(readableTextOn('#1a2a4a')).toBe('#ffffff')
    expect(readableTextOn('oops')).toBe('#ffffff')
  })
})
