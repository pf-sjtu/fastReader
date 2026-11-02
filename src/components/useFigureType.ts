import { useEffect, useMemo, useState } from 'react'
import { FONT_SCALE_EVENT, readFigureType, type FigureType } from '@/lib/figureType'

/**
 * 当前图的排版参数（字体栈 + 字号）。跟随「设置 → 字体大小」（`--font-scale`）与 `--base-font-size`。
 *
 * 为什么要一个 hook：图的字体栈/字号是**写进产物字面量**的（SVG 在 `data:` URI 里、沙箱文档在独立
 * 文档里，都继承不到宿主 CSS），用户改字号后必须重新渲染才生效；而改 CSS 变量不会触发 React 重渲染，
 * 所以由 FontSizeControl 派发 `juhua:font-scale` 事件，这里据此更新。
 *
 * 返回的是整个对象（而不只是 textPx），这样调用方的 `useMemo(..., [figure])` 依赖是真的。
 */
export function useFigureType(): FigureType {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const sync = () => setRevision((n) => n + 1)
    sync() // 挂载时可能已有保存过的字号（FontSizeControl 在 effect 里写入）
    window.addEventListener(FONT_SCALE_EVENT, sync)
    return () => window.removeEventListener(FONT_SCALE_EVENT, sync)
  }, [])

  // revision 是「重新读一次」的触发器；readFigureType 读的是计算后的 CSS 变量
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readFigureType(), [revision])
}
