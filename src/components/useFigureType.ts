import { useEffect, useState } from 'react'
import { FONT_SCALE_EVENT, readFigureType } from '@/lib/figureType'

/**
 * 当前图内文字应有的字号（px）。跟随「设置 → 字体大小」（`--font-scale`）与 `--base-font-size`。
 * 为什么要一个 hook：图的字体栈/字号是**写进 SVG 字面量**的（图片文档继承不到宿主 CSS），
 * 用户改字号后必须重新渲染才生效；而改 CSS 变量不会触发 React 重渲染，所以由 FontSizeControl 派发事件。
 */
export function useFigureTextPx(): number {
  const [textPx, setTextPx] = useState(() => readFigureType().textPx)

  useEffect(() => {
    const sync = () => setTextPx(readFigureType().textPx)
    sync() // 挂载时可能已经有保存过的字号（FontSizeControl 在 effect 里写入）
    window.addEventListener(FONT_SCALE_EVENT, sync)
    return () => window.removeEventListener(FONT_SCALE_EVENT, sync)
  }, [])

  return textPx
}
