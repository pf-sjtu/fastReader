/**
 * v3 章节旁路（ChapterMeta）的云端存档：与完整摘要同名的 `.meta.json`。
 *
 * 云端 MD 里只有正文，旁路（别名、一句话、要点…）不写进去；不另存的话，
 * 从云端 / 历史加载的书会丢失规范实体名，正文标注退回只认图表里的名字。
 * 纯函数，不依赖 WebDAV / React；读写在 cloudCacheService。
 */
import { coerceMeta, type ChapterMeta } from '@/services/prompts/chapterMeta'
import type { Chapter } from '@/types/book'

export const META_SIDECAR_VERSION = 1

export interface MetaSidecar {
  version: number
  /** 写入时 MD 里的章节总数：加载时章节数相同则可按序号对位，不再依赖标题 */
  count: number
  chapters: Array<{ index: number; title: string; meta: ChapterMeta }>
}

/** 没有任何章节带旁路时返回 null（调用方据此跳过上传，不写空文件） */
export function buildMetaSidecar(chapters: ReadonlyArray<Pick<Chapter, 'title' | 'meta'>>): MetaSidecar | null {
  const withMeta = chapters.flatMap((c, index) => (c.meta ? [{ index, title: c.title, meta: c.meta }] : []))
  if (!withMeta.length) return null
  return { version: META_SIDECAR_VERSION, count: chapters.length, chapters: withMeta }
}

const normTitle = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

function titleCompatible(a: string, b: string): boolean {
  const x = normTitle(a)
  const y = normTitle(b)
  return !!x && !!y && (x.includes(y) || y.includes(x))
}

/** 解析云端 JSON；损坏 / 版本不认识 / 结构不对一律返回 null（旁路是锦上添花，不得拖垮加载） */
export function parseMetaSidecar(text: string | null | undefined): MetaSidecar | null {
  if (!text?.trim()) return null
  try {
    const raw = JSON.parse(text) as Partial<MetaSidecar> | null
    if (!raw || typeof raw !== 'object' || raw.version !== META_SIDECAR_VERSION || !Array.isArray(raw.chapters)) {
      return null
    }
    const chapters = raw.chapters.flatMap((c) => {
      const meta = coerceMeta(c?.meta)
      return meta && Number.isInteger(c.index) && c.index >= 0
        ? [{ index: c.index, title: typeof c.title === 'string' ? c.title : '', meta }]
        : []
    })
    return { version: META_SIDECAR_VERSION, count: Number.isInteger(raw.count) ? (raw.count as number) : -1, chapters }
  } catch {
    return null
  }
}

/**
 * 把旁路按序号挂回章节。章节数与写入时一致 → 按序号对位；
 * 不一致（云端 MD 被改过 / 部分重跑）→ 序号对上且标题兼容才挂，宁缺毋错。
 */
export function applyMetaSidecar<T extends Pick<Chapter, 'title' | 'meta'>>(
  chapters: readonly T[],
  sidecar: MetaSidecar | null
): T[] {
  if (!sidecar) return [...chapters]
  const sameShape = sidecar.count === chapters.length
  const byIndex = new Map(sidecar.chapters.map((c) => [c.index, c]))
  return chapters.map((ch, index) => {
    const hit = byIndex.get(index)
    if (!hit || ch.meta) return ch
    if (!sameShape && !titleCompatible(hit.title, ch.title)) return ch
    return { ...ch, meta: hit.meta }
  })
}
