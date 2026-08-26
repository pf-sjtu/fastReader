import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

function Boom() {
  throw new Error('boom-details')
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement
  let root: Root
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    errorSpy.mockRestore()
  })

  it('getDerivedStateFromError 保留 message', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('boom-details'))
    expect(state.hasError).toBe(true)
    expect(state.message).toBe('boom-details')
  })

  it('渲染错误时页面展示 message 与刷新入口', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      )
    })

    expect(container.textContent).toContain('boom-details')
    expect(container.textContent).toContain('刷新页面')
  })
})
