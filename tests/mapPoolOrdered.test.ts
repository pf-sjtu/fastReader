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
        // settled may be out of order
        onItemSettled: () => {},
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

  it('resolves and fires onOrderedResult when mapper returns undefined', async () => {
    const ordered: Array<number | undefined> = []

    const results = await mapPoolOrdered(
      [1, 2, 3],
      async (value) => (value === 2 ? undefined : value),
      {
        concurrency: 2,
        onOrderedResult: (result) => {
          ordered.push(result)
        },
      }
    )

    expect(results).toEqual([1, undefined, 3])
    expect(ordered).toEqual([1, undefined, 3])
  })

  it('resolves when mapper returns null', async () => {
    const ordered: Array<number | null> = []

    const results = await mapPoolOrdered(
      [10, 20],
      async (value) => (value === 10 ? null : value),
      {
        onOrderedResult: (result) => {
          ordered.push(result)
        },
      }
    )

    expect(results).toEqual([null, 20])
    expect(ordered).toEqual([null, 20])
  })
})

describe('mapPoolOrdered 失败与取消（C2）', () => {
  it('首个任务失败后不再出队新任务，并 reject 首个错误', async () => {
    const started: number[] = []
    const err = new Error('boom-1')

    await expect(
      mapPoolOrdered(
        [0, 1, 2, 3, 4, 5],
        async (_v, i) => {
          started.push(i)
          await delay(i === 1 ? 5 : 30)
          if (i === 1) throw err
          if (i === 0) throw new Error('later error')
          return i
        },
        { concurrency: 2 }
      )
    ).rejects.toBe(err)

    // 等已开始任务自然结束，确认没有新任务被拉起
    await delay(60)
    expect(started).toEqual([0, 1])
  })

  it('失败后已开始任务的结果不再触发回调', async () => {
    const ordered: number[] = []
    const settled: number[] = []
    await expect(
      mapPoolOrdered(
        [0, 1],
        async (_v, i) => {
          if (i === 0) throw new Error('x')
          await delay(10)
          return i
        },
        {
          concurrency: 2,
          onOrderedResult: (r) => ordered.push(r),
          onItemSettled: (r) => settled.push(r),
        }
      )
    ).rejects.toThrow('x')
    await delay(20)
    expect(ordered).toEqual([])
    expect(settled).toEqual([])
  })

  it('signal 触发后立即 reject AbortError，且不再出队', async () => {
    const ctrl = new AbortController()
    const started: number[] = []
    const p = mapPoolOrdered(
      [0, 1, 2, 3],
      async (_v, i) => {
        started.push(i)
        await delay(20)
        return i
      },
      { concurrency: 1, signal: ctrl.signal }
    )
    await delay(5)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await delay(40)
    expect(started).toEqual([0])
  })

  it('已取消的 signal 不执行任何任务', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const mapper = vi.fn(async () => 1)
    await expect(mapPoolOrdered([1, 2], mapper, { signal: ctrl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mapper).not.toHaveBeenCalled()
  })

  it('onOrderedResult 抛错时整体 reject', async () => {
    await expect(
      mapPoolOrdered([1, 2], async (v) => v, {
        onOrderedResult: () => {
          throw new Error('cb')
        },
      })
    ).rejects.toThrow('cb')
  })

  it('有 signal 但未触发时正常完成', async () => {
    const results = await mapPoolOrdered([3, 1, 2], async (v) => {
      await delay(v)
      return v * 2
    }, { signal: new AbortController().signal })
    expect(results).toEqual([6, 2, 4])
  })
})
