import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { mount } from './uiTestUtils'
import { ThemeProvider } from '@/components/ThemeProvider'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import i18n from '../src/i18n'
import { readFileSync } from 'node:fs'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme-switching')
  localStorage.clear()
})

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

describe('主题切换：切换那一帧关掉过渡，避免新旧主题色混在一帧', () => {
  it('切换时根元素带 data-theme-switching，两帧后移除；主题类已换', async () => {
    void i18n
    localStorage.setItem('ebook-to-mindmap-theme', 'light')
    m = mount(
      <ThemeProvider>
        <DarkModeToggle />
      </ThemeProvider>
    )
    const root = document.documentElement
    expect(root.classList.contains('light')).toBe(true)
    await act(async () => {
      m!.container.querySelector('button')!.click()
    })
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.hasAttribute('data-theme-switching')).toBe(true)
    await act(async () => {
      await frame()
      await frame()
      await frame()
    })
    expect(root.hasAttribute('data-theme-switching')).toBe(false)
  })

  it('样式表里有对应规则：该属性下所有元素 transition: none !important', () => {
    const css = readFileSync('src/index.css', 'utf-8')
    expect(css).toMatch(/\[data-theme-switching\] \*[\s\S]{0,120}transition:\s*none\s*!important/)
  })
})
