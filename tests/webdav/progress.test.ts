import { describe, it, expect, vi } from 'vitest'
import { createProgressTracker, fractionOf, readBodyWithProgress, type DownloadProgress } from '@/services/webdav/progress'

const MB = 1024 * 1024

describe('createProgressTracker：速度 / ETA / 节流', () => {
  const setup = (total: number | null) => {
    let t = 0
    const seen: DownloadProgress[] = []
    const tr = createProgressTracker(total, (p) => seen.push(p), () => t)
    return { tr, seen, tick: (ms: number) => (t += ms) }
  }

  it('匀速下载：速度收敛到真实值，ETA = 剩余 / 速度', () => {
    const { tr, seen, tick } = setup(100 * MB)
    for (let i = 0; i < 10; i++) {
      tick(500)
      tr.add(1 * MB) // 2 MB/s
    }
    const last = seen[seen.length - 1]
    expect(last.loaded).toBe(10 * MB)
    expect(last.speed).toBeGreaterThan(1.9 * MB)
    expect(last.speed).toBeLessThan(2.1 * MB)
    expect(last.etaSeconds).toBeGreaterThan(40)
    expect(last.etaSeconds).toBeLessThan(50) // (100-10)/2 = 45
  })

  it('速度突然变慢：平滑后逐步下降而不是瞬间归零（ETA 不乱跳）', () => {
    const { tr, seen, tick } = setup(100 * MB)
    for (let i = 0; i < 6; i++) {
      tick(500)
      tr.add(1 * MB)
    }
    const fast = seen[seen.length - 1].speed
    tick(500)
    tr.add(0.1 * MB)
    const slowed = seen[seen.length - 1].speed
    expect(slowed).toBeLessThan(fast)
    expect(slowed).toBeGreaterThan(fast * 0.4) // 一次慢样本不会把平滑速度砸穿
  })

  it('总量未知：只有已下载量与速度，ETA 为 null（界面显示不确定进度）', () => {
    const { tr, seen, tick } = setup(null)
    tick(500)
    tr.add(MB)
    tick(500)
    tr.add(MB)
    const last = seen[seen.length - 1]
    expect(last.total).toBeNull()
    expect(last.etaSeconds).toBeNull()
    expect(last.speed).toBeGreaterThan(0)
  })

  it('回调节流：同一时刻连来很多小分块不会每块都回调；done() 无条件回报最终值', () => {
    const { tr, seen, tick } = setup(10 * MB)
    tick(500)
    for (let i = 0; i < 50; i++) tr.add(1000)
    expect(seen.length).toBeLessThan(5)
    tr.done()
    expect(seen[seen.length - 1]).toMatchObject({ loaded: 50_000, etaSeconds: 0 })
  })

  it('刚开始（样本太少）速度为 0 → ETA 为 null，不给出离谱的估计', () => {
    const { tr, tick } = setup(10 * MB)
    tick(10) // 短于最小采样窗口
    tr.add(1000)
    const first = tr.snapshot()
    expect(first.speed).toBe(0)
    expect(first.etaSeconds).toBeNull()
  })
})

describe('fractionOf', () => {
  it('总量未知 → null；已下载超过总量 → 封顶 0.99（读完才算 100%）', () => {
    expect(fractionOf({ loaded: 5, total: null })).toBeNull()
    expect(fractionOf({ loaded: 50, total: 100 })).toBe(0.5)
    expect(fractionOf({ loaded: 120, total: 100 })).toBe(0.99)
  })
})

/** 用真实 ReadableStream 造一个分块响应 */
const streamed = (chunks: Uint8Array[], headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(x))
        c.close()
      },
    }),
    { headers }
  )
const bytes = (n: number, v = 1) => new Uint8Array(n).fill(v)

describe('readBodyWithProgress', () => {
  it('分块读完并合并，内容与顺序不变；回报逐步增长的进度，结束为 100%', async () => {
    const res = streamed([bytes(3, 1), bytes(4, 2), bytes(5, 3)], { 'Content-Length': '12' })
    const seen: DownloadProgress[] = []
    const buf = await readBodyWithProgress(res, { onProgress: (p) => seen.push(p) })
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3])
    expect(seen[seen.length - 1]).toMatchObject({ loaded: 12, total: 12, etaSeconds: 0 })
  })

  it('没有 Content-Length：用调用方给的 expectedSize（书库索引里记的大小）作总量', async () => {
    const seen: DownloadProgress[] = []
    await readBodyWithProgress(streamed([bytes(10)]), { expectedSize: 10, onProgress: (p) => seen.push(p) })
    expect(seen[seen.length - 1].total).toBe(10)
  })

  it('既没有 Content-Length 也不知道大小：total 为 null，仍给出已下载量', async () => {
    const seen: DownloadProgress[] = []
    await readBodyWithProgress(streamed([bytes(10)]), { onProgress: (p) => seen.push(p) })
    expect(seen[seen.length - 1]).toMatchObject({ loaded: 10, total: null })
  })

  it('Content-Length 优先于 expectedSize（服务器说了算）', async () => {
    const seen: DownloadProgress[] = []
    await readBodyWithProgress(streamed([bytes(8)], { 'Content-Length': '8' }), { expectedSize: 999, onProgress: (p) => seen.push(p) })
    expect(seen[seen.length - 1].total).toBe(8)
  })

  it('取消：读到一半 abort → 抛 AbortError（调用方据此区分「用户取消」与「网络失败」），且停止读取', async () => {
    const ac = new AbortController()
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        pulls++
        await new Promise((r) => setTimeout(r, 5))
        c.enqueue(bytes(10))
        if (pulls === 2) ac.abort()
      },
    })
    await expect(readBodyWithProgress(new Response(body), { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const after = pulls
    await new Promise((r) => setTimeout(r, 30))
    expect(pulls).toBeLessThanOrEqual(after + 1) // 已取消，不会一直拉下去
  })

  it('已经 aborted 的信号：不读任何数据直接抛', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(readBodyWithProgress(streamed([bytes(5)]), { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('没有 body 流（极少数环境）：退回一次性读取，仍回报完成', async () => {
    const res = { headers: new Headers({ 'Content-Length': '4' }), body: null, arrayBuffer: async () => bytes(4).buffer } as unknown as Response
    const onProgress = vi.fn()
    const buf = await readBodyWithProgress(res, { onProgress })
    expect(buf.byteLength).toBe(4)
    expect(onProgress).toHaveBeenCalled()
  })
})
