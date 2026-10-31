import { useEffect, useState } from 'react'

/** 视口宽度（随窗口缩放更新）；没有 window（SSR/部分测试环境）时返回 null */
export function useViewportWidth(): number | null {
  const [w, setW] = useState<number | null>(typeof window === 'undefined' ? null : window.innerWidth)
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return w
}
