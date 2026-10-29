// 共享状态的 KV 存取：分节 + 版本号（rev）实现乐观锁

/** 受支持的共享分区 */
export const SECTIONS = ['ai', 'processing', 'webdav', 'prompts', 'history', 'batch', 'usage']

/** 追加型分区（服务端合并，天然无冲突） */
export const APPEND_SECTIONS = ['history', 'usage']

const stateKey = (section) => `state:${section}`

export function getKv(env) {
  const kv = env?.FASTREADER_KV
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    const error = new Error('KV binding FASTREADER_KV is not configured')
    error.code = 'kv_missing'
    throw error
  }
  return kv
}

export function isSection(value) {
  return typeof value === 'string' && SECTIONS.includes(value)
}

/** 读取单节；不存在时返回 null */
export async function readSection(env, section) {
  const raw = await getKv(env).get(stateKey(section))
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null
    return {
      rev: Number(parsed.rev) || 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      data: parsed.data ?? {},
    }
  } catch {
    return null
  }
}

/** 读取全部节；missing 列出尚未初始化的节 */
export async function readAllSections(env) {
  const loaded = await Promise.all(SECTIONS.map(async (section) => [section, await readSection(env, section)]))
  const sections = {}
  const missing = []
  for (const [section, value] of loaded) {
    if (value) sections[section] = value
    else missing.push(section)
  }
  return { sections, missing }
}

/**
 * 带乐观锁的写入。
 *
 * @param expectedRev `If-Match` 的值；null 表示「不校验」（强写，仅用于迁移/初始化）
 * @returns `{ok:true, rev}` 或 `{ok:false, conflict:{rev, updatedAt, data}}`
 */
export async function writeSection(env, section, data, expectedRev) {
  const kv = getKv(env)
  const current = await readSection(env, section)
  const currentRev = current?.rev ?? 0

  if (expectedRev !== null && expectedRev !== undefined && Number(expectedRev) !== currentRev) {
    return {
      ok: false,
      conflict: current ?? { rev: 0, updatedAt: new Date(0).toISOString(), data: {} },
    }
  }

  const next = {
    rev: currentRev + 1,
    updatedAt: new Date().toISOString(),
    data,
  }
  await kv.put(stateKey(section), JSON.stringify(next))
  return { ok: true, rev: next.rev, updatedAt: next.updatedAt }
}

/** 追加型写入：由调用方提供 merge(currentData, patch) */
export async function appendSection(env, section, patch, merge) {
  const current = await readSection(env, section)
  const merged = merge(current?.data ?? {}, patch)
  const result = await writeSection(env, section, merged, null)
  return { ...result, data: merged }
}
