import { useRef, type MouseEvent, type PointerEvent } from 'react'

/**
 * 触屏长按（鼠标不触发，鼠标用悬浮卡 / 详情按钮）。长按触发后吞掉紧接着的那次 click，
 * 否则"想看详情"会变成"打开这本书"（打开 = 去 WebDAV 下载整本）。
 * 手指移动或抬起、取消都会中止计时（滚动书架时不会误触发）。
 */
export function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fired = useRef(false)
  const stop = () => clearTimeout(timer.current)
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      fired.current = false
      stop()
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress()
      }, ms)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return
      fired.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    // 安卓长按会弹系统上下文菜单：我们已经接管了这次长按
    onContextMenu: (e: MouseEvent) => {
      if (fired.current) e.preventDefault()
    },
  }
}
