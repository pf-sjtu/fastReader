// UI 测试最小渲染工具：项目未安装 @testing-library，用 react-dom/client + act 自写
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export interface Mounted {
  container: HTMLDivElement
  root: Root
  rerender: (node: ReactNode) => void
  unmount: () => void
}

export function mount(node: ReactNode): Mounted {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return {
    container,
    root,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** 在整个 document 中按可见文本找按钮（Radix 弹层渲染在 portal 里） */
export function findButton(text: string | RegExp): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')
  )
}

export function click(el: Element | null | undefined) {
  if (!el) throw new Error('click: 元素不存在')
  act(() => {
    ;(el as HTMLElement).click()
  })
}

/** 刷新异步任务（含宏任务：动态 import 需要真实 I/O 轮次） */
export async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

/** 受控 input 赋值：绕过 React 的 value 追踪后派发 input 事件 */
export function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export function pressKey(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

/** 轮询直到断言通过（异步 effect + 动态 import 的完成时机受负载影响） */
export async function waitFor(assertion: () => void, timeoutMs = 3000) {
  const start = Date.now()
  // 先在 act 内刷新一轮：让已排队的 promise 回调（setState）在 act 中完成，避免 "not wrapped in act" 警告
  await flush(1)
  for (;;) {
    try {
      assertion()
      return
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err
      await flush(1)
    }
  }
}

/** jsdom 缺少的 DOM API（Radix Select / Popper 需要） */
export function stubDomForRadix() {
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.scrollIntoView ??= () => {}
  proto.hasPointerCapture ??= () => false
  proto.releasePointerCapture ??= () => {}
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

/** 通过键盘操作 Radix Select：ArrowDown 打开，在选项上按 Enter 选中 */
export async function selectOption(trigger: Element | null | undefined, optionText: string | RegExp) {
  if (!trigger) throw new Error('selectOption: trigger 不存在')
  pressKey(trigger, 'ArrowDown')
  await flush(1)
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) =>
    typeof optionText === 'string' ? o.textContent?.trim() === optionText : optionText.test(o.textContent ?? '')
  )
  if (!option) throw new Error(`selectOption: 未找到选项 ${String(optionText)}`)
  pressKey(option, 'Enter')
  await flush(1)
}
