import { useSyncExternalStore } from 'react'

/** 与 LibraryView 的 GRID 断点一一对应（Tailwind sm=640 / lg=1024）：4 / 6 / 8 列 */
const QUERIES = [
  { q: '(min-width: 1024px)', cols: 8 },
  { q: '(min-width: 640px)', cols: 6 },
] as const
const FALLBACK = 6 // 没有 matchMedia（测试 / 极老浏览器）时按中档

const read = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return FALLBACK
  return QUERIES.find((x) => window.matchMedia(x.q).matches)?.cols ?? 4
}

const subscribe = (cb: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const lists = QUERIES.map((x) => window.matchMedia(x.q))
  lists.forEach((l) => l.addEventListener('change', cb))
  return () => lists.forEach((l) => l.removeEventListener('change', cb))
}

/** 当前封面墙每行几本：推荐数取「列数 × 行数」，保证每一行都是满的 */
export function useGridColumns(): number {
  return useSyncExternalStore(subscribe, read, () => FALLBACK)
}
