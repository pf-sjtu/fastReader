/**
 * 把各章旁路（v3 chapterMeta.entities）里的「规范名 + 别名」并入图表实体，
 * 让正文里的缩写 / 全称 / 别名都标成同一个实体（如 KKR ↔ Kohlberg Kravis Roberts）。
 * 纯函数，不依赖 DOM / React。
 */
import { nameVariants } from './entityIndex'

export interface MetaEntityLike {
  name: string
  aliases?: readonly string[]
}

export interface MetaLike {
  entities: readonly MetaEntityLike[]
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * 返回 实体 id → 追加别名。归属判定：旁路实体的任一写法（规范名/别名）与图表实体名的
 * 全名或变体（括号内外、· 拆分片段）完全相等（忽略大小写）。
 * 多个图表实体都能对上同一旁路实体时，只并给第一个（顺序即优先级），避免一个别名挂到两个实体上。
 */
export function aliasesFromMetas(
  entities: readonly { id: string; name: string }[],
  metas: ReadonlyArray<MetaLike | null | undefined>
): Map<string, string[]> {
  const owner = new Map<string, string>() // 图表实体的任一写法 → 实体 id（先到先得）
  for (const e of entities) {
    for (const v of [e.name, ...nameVariants(e.name)]) {
      const k = norm(v)
      if (k && !owner.has(k)) owner.set(k, e.id)
    }
  }
  const out = new Map<string, Set<string>>()
  for (const meta of metas) {
    for (const me of meta?.entities ?? []) {
      const names = [me.name, ...(me.aliases ?? [])].map((s) => s.trim()).filter(Boolean)
      const id = names.map((n) => owner.get(norm(n))).find((x): x is string => !!x)
      if (!id) continue
      const set = out.get(id) ?? new Set<string>()
      for (const n of names) if (owner.get(norm(n)) !== id) set.add(n)
      // 已经归属其他实体的写法不抢：由上面的 owner 判断排除；这里只加「无主」写法
      out.set(id, set)
    }
  }
  const result = new Map<string, string[]>()
  for (const [id, set] of out) {
    const own = new Set(entities.find((e) => e.id === id) ? [norm(entities.find((e) => e.id === id)!.name)] : [])
    const list = [...set].filter((n) => !own.has(norm(n)) && !(owner.has(norm(n)) && owner.get(norm(n)) !== id))
    if (list.length) result.set(id, list)
  }
  return result
}
