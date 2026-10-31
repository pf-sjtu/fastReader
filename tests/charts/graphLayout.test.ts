import { describe, it, expect } from 'vitest'
import { cellSide, compactScale, type LayoutPoint } from '@/charts/plugins/person-graph/toCytoscape'

/** 在 side×side 范围内按网格摆 n 个半径 r 的点 */
function grid(n: number, side: number, r = 37): LayoutPoint[] {
  const cols = Math.ceil(Math.sqrt(n))
  const step = side / Math.max(cols - 1, 1)
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) * step, y: Math.floor(i / cols) * step, r }))
}

function minGapRatio(points: LayoutPoint[], s: number): number {
  let worst = Infinity
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) * s
      worst = Math.min(worst, d / (points[i].r + points[j].r))
    }
  return worst
}

describe('cellSide', () => {
  it('随力强度单调增长并夹在 0–100', () => {
    expect(cellSide(0)).toBe(110)
    expect(cellSide(100)).toBe(230)
    expect(cellSide(-5)).toBe(110)
    expect(cellSide(999)).toBe(230)
    expect(cellSide(55)).toBeGreaterThan(cellSide(20))
  })
})

describe('compactScale', () => {
  it('少于 2 个点不压缩', () => {
    expect(compactScale([], 55)).toBe(1)
    expect(compactScale([{ x: 0, y: 0, r: 30 }], 55)).toBe(1)
  })

  it('被撑得过大的布局被压缩（22 个点撑到 2400×2400）', () => {
    const pts = grid(22, 2400)
    const s = compactScale(pts, 55)
    expect(s).toBeLessThan(0.6)
    expect(s).toBeGreaterThan(0)
  })

  it('已经很紧凑的布局不动', () => {
    expect(compactScale(grid(22, 500), 55)).toBe(1)
  })

  it('防重叠下限：面积法会压过头时，由最近的一对兜住（间距 ≥ 半径和 ×1.25）', () => {
    // 一对中心距 200 的近邻 + 几个很远的离群点：整体面积很大，面积法给出 ≈0.2，
    // 但按 0.2 压缩后近邻只剩 40px，已经重叠；下限应把系数抬到 (37+37)*1.25/200 ≈ 0.4625
    const pts: LayoutPoint[] = [
      { x: 0, y: 0, r: 37 },
      { x: 200, y: 0, r: 37 },
      { x: 4000, y: 0, r: 37 },
      { x: 0, y: 4000, r: 37 },
      { x: 4000, y: 4000, r: 37 },
    ]
    const s = compactScale(pts, 0)
    expect(s).toBeCloseTo((74 * 1.25) / 200, 4)
    expect(minGapRatio(pts, s)).toBeGreaterThanOrEqual(1.25 - 1e-9)
  })

  it('近邻本来就贴得很紧时放弃压缩（系数封顶 1）', () => {
    const pts: LayoutPoint[] = [
      { x: 0, y: 0, r: 37 },
      { x: 80, y: 0, r: 37 }, // 80 < 92.5：要保证间隙只能放大，但系数不会超过 1
      { x: 5000, y: 5000, r: 37 },
    ]
    expect(compactScale(pts, 0)).toBe(1)
  })

  it('力强度越大压缩越轻（滑块仍然有效）', () => {
    const pts = grid(22, 2400)
    expect(compactScale(pts, 100)).toBeGreaterThan(compactScale(pts, 0))
  })

  it('退化为一条线时不会除零', () => {
    const line: LayoutPoint[] = Array.from({ length: 6 }, (_, i) => ({ x: i * 300, y: 0, r: 37 }))
    const s = compactScale(line, 55)
    expect(Number.isFinite(s)).toBe(true)
    expect(s).toBeLessThanOrEqual(1)
  })

  it('重合的点（距离 0）不产生 NaN', () => {
    const s = compactScale([{ x: 0, y: 0, r: 30 }, { x: 0, y: 0, r: 30 }, { x: 900, y: 900, r: 30 }], 55)
    expect(Number.isFinite(s)).toBe(true)
  })
})
