/**
 * 信封的读写：WebDAV（经 `/api/dav` 代理）+ gzip，路径规则与解析在 `envelope.ts`。
 *
 * 两条硬规矩：
 * - 同步是**尽力而为**：没有 WebDAV、断网、写得失败都只记一笔 warn，绝不让生成流程失败。
 * - 云端信封版本更高 / 结构读不懂 / 这一轮没读成时**一律不许覆盖**（`saveArtifact` 的 `known` 参数），
 *   免得降级客户端抹掉新格式，也免得一次网络抖动拿本机旧副本盖掉别的设备写的新副本。
 */
import { useConfigStore } from '@/stores/configStore'
import { gunzipToText, gzipText, isGzip } from '@/services/library/gzip'
import { webdavService } from '@/services/webdavService'
import { logger } from '@/lib/logger'
import {
  artifactPath,
  parseEnvelopeText,
  serializeEnvelope,
  type ArtifactEnvelope,
  type ArtifactKind,
  type ParsedEnvelope,
} from './envelope'

export interface ArtifactEntry {
  path: string
  basename: string
  size: number
  mtime?: string
}

/** 信封 IO 的最小接口：生产实现走 WebDAV，单测注入假实现 */
export interface ArtifactIO {
  /** 读文本；不存在返回 null；其它错误抛出 */
  read(path: string): Promise<string | null>
  /** 写文本（建目录 + 覆盖）；失败返回 false，不抛 */
  write(path: string, text: string): Promise<boolean>
  /** 列目录（不递归）；目录不存在或读失败都返回 [] */
  list(dir: string): Promise<ArtifactEntry[]>
  /** 删整个目录（整包清理）；失败返回 false */
  removeDir(dir: string): Promise<boolean>
}

/** 生产实现：WebDAV + gzip（信封是 JSON，压缩后通常只剩 1/5） */
export function createArtifactIO(): ArtifactIO | null {
  if (!webdavService.isInitialized()) return null
  return {
    read: async (path) => {
      // 不存在 ≠ 读取失败：前者是首次使用，后者要交给调用方（这里统一当「读不到」）
      const status = await webdavService.existsStatus(path)
      if (status === 'missing') return null
      const r = await webdavService.getFileContents(path, 'binary')
      if (!r.success || !(r.data instanceof ArrayBuffer)) throw new Error(r.error ?? `读取产物失败：${path}`)
      return isGzip(r.data) ? gunzipToText(r.data) : new TextDecoder().decode(r.data)
    },
    write: async (path, text) => {
      try {
        const r = await webdavService.putFileContents(path, await gzipText(text), true)
        return r.success
      } catch {
        return false
      }
    },
    list: async (dir) => {
      try {
        const r = await webdavService.getDirectoryContents(dir)
        if (!r.success || !r.data) return []
        return r.data
          .filter((f) => f.type === 'file')
          .map((f) => ({ path: f.filename, basename: f.basename, size: f.size ?? 0, mtime: f.lastmod }))
      } catch {
        return []
      }
    },
    removeDir: async (dir) => {
      try {
        return (await webdavService.deleteDirectory(dir)).success
      } catch {
        return false
      }
    },
  }
}

/** 一次同步的上下文：目标 WebDAV 客户端 + 同步目录 + 书身份 */
export interface SyncContext {
  io: ArtifactIO
  syncPath: string
  bookKey: string
}

/**
 * 取当前同步上下文。没有启用 WebDAV / 还没连上 / 传了 `null` 都返回 null——
 * 调用方照常走本机缓存（离线编辑的常态），不会因为它中断。
 */
export function syncContextFor(bookKey: string, io?: ArtifactIO | null): SyncContext | null {
  const cfg = useConfigStore.getState().webdavConfig
  if (!cfg.enabled) return null
  const resolved = io === undefined ? createArtifactIO() : io
  if (!resolved) return null
  return { io: resolved, syncPath: cfg.syncPath || '/fastReader', bookKey }
}

/**
 * 读一份信封的结果。
 *
 * 为什么要把「云端没有」与「读失败」分开：前者是本机内容该推上去（首次同步），
 * 后者是**我们不知道云端有什么**——这时绝不能拿本机那份去覆盖，否则一次 500 / 断网
 * 就会把另一台设备写好的较新副本抹掉（读都没读成，`saveArtifact` 的守卫也无从生效）。
 */
export type ArtifactLoad<T = unknown> = ParsedEnvelope<T> | { status: 'missing' } | { status: 'error'; error: unknown }

/** 读到这个状态时不能写回：云端版本更高、结构读不懂、或压根没读成 */
const holdsUnknown = (known: ArtifactLoad<unknown> | null | undefined): boolean =>
  !!known && (known.status === 'newer' || known.status === 'bad' || known.status === 'error')

/** 读一份信封的完整结果（调用方要据此决定「能不能写回」时用它） */
export async function loadArtifactResult<T = unknown>(kind: ArtifactKind, ctx: SyncContext | null): Promise<ArtifactLoad<T>> {
  if (!ctx) return { status: 'missing' }
  try {
    const text = await ctx.io.read(artifactPath(ctx.syncPath, ctx.bookKey, kind))
    if (text == null) return { status: 'missing' }
    return parseEnvelopeText<T>(text, kind)
  } catch (e) {
    logger.warn('[artifacts] 读取失败', kind, ctx.bookKey, e)
    return { status: 'error', error: e }
  }
}

/** 读一份信封：没有 / 读不懂 / 网络失败都返回 null（只看「有没有能合并的内容」时用它） */
export async function loadArtifact<T = unknown>(
  kind: ArtifactKind,
  ctx: SyncContext | null
): Promise<ParsedEnvelope<T> | null> {
  const r = await loadArtifactResult<T>(kind, ctx)
  return r.status === 'missing' || r.status === 'error' ? null : r
}

/**
 * 写一份信封。`known` 是本次已经读到的旧信封：更高版本 / 读不懂 / 读失败都放弃覆盖，
 * 只记一笔 warn（同步是尽力而为，本机那份照常留着）。
 * 返回是否真的写成功（调用方通常忽略，失败已记日志）。
 */
export async function saveArtifact<T>(
  env: ArtifactEnvelope<T>,
  ctx: SyncContext | null,
  known?: ArtifactLoad<unknown> | null
): Promise<boolean> {
  if (!ctx) return false
  if (holdsUnknown(known)) {
    logger.warn('[artifacts] 云端信封版本更高或读不懂，跳过写入', env.kind, env.bookKey, known?.status)
    return false
  }
  try {
    return await ctx.io.write(artifactPath(ctx.syncPath, env.bookKey, env.kind), serializeEnvelope(env))
  } catch (e) {
    logger.warn('[artifacts] 写入失败', env.kind, env.bookKey, e)
    return false
  }
}
