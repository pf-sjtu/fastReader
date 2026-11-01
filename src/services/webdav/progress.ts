/**
 * 下载进度：流式读取响应体，给出「已下载 / 总量 / 速度 / 预计剩余 / 是否卡顿」。
 * 让用户知道一本几十 MB 的书在下载而不是卡死。纯逻辑，不依赖 React / WebDAV，便于单测。
 */

export interface DownloadProgress {
  loaded: number
  /** 总字节数；服务器没给 Content-Length（分块 / 压缩传输）且调用方也不知道大小时为 null → 界面显示不确定进度 */
  total: number | null
  /** 平滑后的速度（字节/秒）；刚开始还没有足够样本时为 0 */
  speed: number
  /** 预计剩余秒数；总量未知 / 速度未知时为 null */
  etaSeconds: number | null
}

export interface ProgressOptions {
  onProgress?: (p: DownloadProgress) => void
  signal?: AbortSignal
  /** 响应里没有 Content-Length 时的回退总量（如书库索引里记的文件大小） */
  expectedSize?: number
}

/** 速度的指数平滑系数：越大越灵敏、越小越稳。0.3 在「别乱跳」与「能反映变慢」之间折中 */
const SPEED_ALPHA = 0.3
/** 两次回调之间的最小间隔（毫秒）：大文件每个分块都回调会拖慢界面 */
const MIN_EMIT_INTERVAL = 150
/** 速度采样窗口下限：短于它的样本噪声太大，攒够再算 */
const MIN_SAMPLE_MS = 250

export function createProgressTracker(total: number | null, emit: (p: DownloadProgress) => void, now: () => number = () => performance.now()) {
  let loaded = 0
  let speed = 0
  let lastT = now()
  let lastLoaded = 0
  let lastEmit = 0

  const snapshot = (): DownloadProgress => ({
    loaded,
    total,
    speed,
    etaSeconds: total != null && speed > 0 ? Math.max(0, Math.round((total - loaded) / speed)) : null,
  })

  return {
    /** 收到一个分块 */
    add(bytes: number) {
      loaded += bytes
      const t = now()
      const dt = t - lastT
      if (dt >= MIN_SAMPLE_MS) {
        const inst = ((loaded - lastLoaded) / dt) * 1000
        speed = speed === 0 ? inst : SPEED_ALPHA * inst + (1 - SPEED_ALPHA) * speed
        lastT = t
        lastLoaded = loaded
      }
      if (t - lastEmit >= MIN_EMIT_INTERVAL) {
        lastEmit = t
        emit(snapshot())
      }
    },
    /** 结束时无条件回报最终值（节流可能吞掉了最后一次） */
    done() {
      emit({ ...snapshot(), etaSeconds: 0 })
    },
    snapshot,
  }
}

const parseLength = (res: Response): number | null => {
  const n = Number(res.headers.get('Content-Length'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 流式读完响应体并回报进度。拿不到 body 流（极少数环境）时退回一次性 arrayBuffer，仍在结束时回报 100%。
 * signal 中止时抛出 AbortError，调用方据此区分「用户取消」与「网络失败」。
 */
export async function readBodyWithProgress(res: Response, opts: ProgressOptions = {}): Promise<ArrayBuffer> {
  const { onProgress, signal, expectedSize } = opts
  const header = parseLength(res)
  // 经代理 / 压缩后 Content-Length 可能小于真实字节数：已下载量超过它就当作总量未知，避免出现 >100%
  const total = header ?? (expectedSize && expectedSize > 0 ? expectedSize : null)
  const tracker = createProgressTracker(total, (p) => onProgress?.(p))
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = await res.arrayBuffer()
    tracker.add(buf.byteLength)
    tracker.done()
    return buf
  }

  const chunks: Uint8Array[] = []
  let received = 0
  const onAbort = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        tracker.add(value.byteLength)
      }
    }
    if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError')
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  tracker.done()

  // 合并分块（预分配一次，避免反复拷贝）
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer
}

/** 进度 → 0..1；总量未知返回 null（界面显示不确定进度）。已下载超过总量时封顶 0.99，等真正读完再到 1 */
export const fractionOf = (p: Pick<DownloadProgress, 'loaded' | 'total'>): number | null =>
  p.total ? Math.min(0.99, p.loaded / p.total) : null
