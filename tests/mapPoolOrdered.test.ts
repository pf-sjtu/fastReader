import { describe, it, expect, vi } from 'vitest'
import { clampConcurrency, mapPoolOrdered } from '../src/utils/async'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('clampConcurrency', () => {
  it('defaults and clamps', () => {
    expect(clampConcurrency(undefined)).toBe(3)
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(-2)).toBe(1)
    expect(clampConcurrency(99)).toBe(10)
    expect(clampConcurrency(4)).toBe(4)
    expect(clampConcurrency(3.9)).toBe(3)
  })
})

describe('mapPoolOrdered', () => {
  it('returns results in input order even when slower items finish later', async () => {
    const durations = [40, 5, 20, 10]
    const started: number[] = []
    const settled: number[] = []
    const ordered: number[] = []

    const results = await mapPoolOrdered(
      durations,
      async (ms, index) => {
        started.push(index)
        await delay(ms)
        settled.push(index)
        return index
      },
      {
        concurrency: 2,
        onItemSettled: (_r, index) => {
          // settled may be out of order
        },
        onOrderedResult: (r) => {
          ordered.push(r)
        },
      }
    )

    expect(results).toEqual([0, 1, 2, 3])
    expect(ordered).toEqual([0, 1, 2, 3])
    // 完成顺序应不同于输入顺序（至少 1 应先于 0 完成）
    expect(settled.indexOf(1)).toBeLessThan(settled.indexOf(0))
  })

  it('respects concurrency limit', async () => {
    let running = 0
    let peak = 0

    await mapPoolOrdered(
      [1, 2, 3, 4, 5, 6],
      async () => {
        running++
        peak = Math.max(peak, running)
        await delay(15)
        running--
        return 1
      },
      { concurrency: 3 }
    )

    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('onOrderedResult never jumps ahead of earlier indices', async () => {
    const seen: number[] = []
    await mapPoolOrdered(
      [30, 1, 20, 5],
      async (ms, i) => {
        await delay(ms)
        return i
      },
      {
        concurrency: 4,
        onOrderedResult: (_r, index) => {
          if (seen.length > 0) {
            expect(index).toBe(seen[seen.length - 1] + 1)
          } else {
            expect(index).toBe(0)
          }
          seen.push(index)
        },
      }
    )
    expect(seen).toEqual([0, 1, 2, 3])
  })

  it('handles empty input', async () => {
    const spy = vi.fn()
    const results = await mapPoolOrdered([], async (x) => x, {
      onOrderedResult: spy,
    })
    expect(results).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})
