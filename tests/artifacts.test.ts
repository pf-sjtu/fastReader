import { describe, it, expect, vi } from 'vitest'
import {
  ARTIFACT_DIR,
  ARTIFACT_SCHEMA,
  artifactDirOf,
  artifactPath,
  bookFolderOf,
  bookKeyOf,
  buildEnvelope,
  fnv1a,
  isInputsStale,
  loadArtifact,
  loadArtifactResult,
  parseEnvelope,
  parseEnvelopeText,
  saveArtifact,
  type ArtifactEntry,
  type ArtifactEnvelope,
  type ArtifactIO,
  type SyncContext,
} from '@/services/artifacts'

/** 内存 IO：路径 → 文本。生产实现是 WebDAV + gzip，这里只关心文本语义 */
class FakeIO implements ArtifactIO {
  files = new Map<string, string>()
  writes: string[] = []
  failWrite = false
  throwOnRead = false

  async read(path: string): Promise<string | null> {
    if (this.throwOnRead) throw new Error('boom')
    return this.files.get(path) ?? null
  }

  async write(path: string, text: string): Promise<boolean> {
    if (this.failWrite) return false
    this.files.set(path, text)
    this.writes.push(path)
    return true
  }

  async list(dir: string): Promise<ArtifactEntry[]> {
    const prefix = dir.replace(/\/+$/, '') + '/'
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map((p) => ({ path: p, basename: p.slice(prefix.length), size: p.length }))
  }

  async removeDir(dir: string): Promise<boolean> {
    const prefix = dir.replace(/\/+$/, '') + '/'
    for (const p of [...this.files.keys()]) if (p.startsWith(prefix)) this.files.delete(p)
    return true
  }
}

const ctxOf = (io: ArtifactIO, bookKey: string, syncPath = '/fastReader'): SyncContext => ({ io, syncPath, bookKey })

const sample = <T>(data: T, now = 1000): ArtifactEnvelope<T> =>
  buildEnvelope({ kind: 'study', bookKey: '人类简史|尤瓦尔', title: '人类简史', author: '尤瓦尔', inputsFp: 'fp1', data, now })

describe('信封路径', () => {
  it('书身份与内容无关：书名 | 作者', () => {
    expect(bookKeyOf({ title: '书', author: '人' })).toBe('书|人')
    expect(bookKeyOf({})).toBe('|')
    // 同一本书无论章节总结怎么变，身份都不变
    expect(bookKeyOf({ title: '书', author: '人' })).toBe(bookKeyOf({ title: '书', author: '人' }))
  })

  it('目录名去掉 WebDAV 不接受的字符并带哈希', () => {
    const folder = bookFolderOf('人/类:简史*|尤瓦尔')
    expect(folder.startsWith('人-类-简史-~')).toBe(true)
    expect(folder).not.toMatch(/[\\/:*?"<>|]/)
    // 清洗后同名的两本书不能撞目录
    expect(bookFolderOf('A|B')).not.toBe(bookFolderOf('A?|B'))
  })

  it('书名里的百分号也要剥掉：目录名带 % 会让清理侧无法区分正常名与编码过的名字', () => {
    const folder = bookFolderOf('打折100%的书|人')
    expect(folder).not.toContain('%')
    expect(folder.startsWith('打折100-的书~')).toBe(true)
  })

  it('路径落在 .juhua/books 下，按 kind 分文件', () => {
    expect(artifactDirOf('/fastReader/', '书|人')).toBe(`/fastReader/${ARTIFACT_DIR}/${bookFolderOf('书|人')}`)
    expect(artifactPath('/fastReader/', '书|人', 'quiz')).toBe(
      `/fastReader/${ARTIFACT_DIR}/${bookFolderOf('书|人')}/quiz.json.gz`
    )
    // 同步目录末尾斜杠不影响结果
    expect(artifactPath('/fastReader', '书|人', 'notes')).toBe(artifactPath('/fastReader///', '书|人', 'notes'))
  })

  it('fnv1a 稳定且区分大小写', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).not.toBe(fnv1a('Abc'))
  })
})

describe('信封构造与解析', () => {
  it('构造时补齐默认值，更新时保留首次生成时间', () => {
    const env = buildEnvelope({ kind: 'quiz', bookKey: 'b', title: 't', data: {}, now: 100 })
    expect(env).toMatchObject({ schema: ARTIFACT_SCHEMA, kind: 'quiz', inputsFp: '', createdAt: 100, updatedAt: 100 })
    const updated = buildEnvelope({ kind: 'quiz', bookKey: 'b', title: 't', data: {}, now: 200, createdAt: 100 })
    expect(updated.createdAt).toBe(100)
    expect(updated.updatedAt).toBe(200)
  })

  it('往返：序列化后解析回来是同一份', () => {
    const env = sample({ kit: 1 })
    const parsed = parseEnvelopeText<{ kit: number }>(JSON.stringify(env), 'study')
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.env).toEqual(env)
    expect(parsed.env.data).toEqual({ kit: 1 })
  })

  it('版本更高的信封只认「更新」，绝不当作自己的数据', () => {
    const parsed = parseEnvelope({ schema: ARTIFACT_SCHEMA + 1, kind: 'study', bookKey: 'b', data: {} }, 'study')
    expect(parsed).toEqual({ status: 'newer', schema: ARTIFACT_SCHEMA + 1 })
  })

  it('读不懂的一律 bad：不是对象、缺版本、kind 不符、坏 JSON', () => {
    expect(parseEnvelope(null, 'study').status).toBe('bad')
    expect(parseEnvelope([], 'study').status).toBe('bad')
    expect(parseEnvelope({ kind: 'study', bookKey: 'b' }, 'study').status).toBe('bad')
    expect(parseEnvelope({ schema: 2, kind: 'notes', bookKey: 'b' }, 'study')).toEqual({
      status: 'bad',
      reason: 'kind-mismatch',
    })
    expect(parseEnvelope({ schema: 2, kind: 'study', bookKey: '' }, 'study').status).toBe('bad')
    expect(parseEnvelopeText('{ not json', 'study')).toEqual({ status: 'bad', reason: 'invalid-json' })
  })

  it('缺字段按缺处理，不塞 undefined 进对象', () => {
    const parsed = parseEnvelope({ schema: 1, kind: 'notes', bookKey: 'b', title: 't', data: [] }, 'notes')
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.env.inputsFp).toBe('')
    expect('author' in parsed.env).toBe(false)
    expect(parsed.env.createdAt).toBe(0)
  })
})

describe('过时判定', () => {
  it('只有上游指纹不同才算过时；任一为空都无从判定', () => {
    expect(isInputsStale('a', 'b')).toBe(true)
    expect(isInputsStale('a', 'a')).toBe(false)
    expect(isInputsStale('', 'b')).toBe(false)
    expect(isInputsStale('a', '')).toBe(false)
  })
})

describe('信封读写', () => {
  it('没有同步上下文时：读返回 null、写返回 false（离线照常工作）', async () => {
    expect(await loadArtifact('study', null)).toBeNull()
    expect(await saveArtifact(sample({}), null)).toBe(false)
  })

  it('写出去的是这个路径的信封，再读回来一致', async () => {
    const io = new FakeIO()
    // 写用信封自带的 bookKey，读用上下文的 bookKey：两者必须来自同一本书
    const ctx = ctxOf(io, '人类简史|尤瓦尔')
    expect(await saveArtifact(sample({ v: 1 }, 500), ctx)).toBe(true)
    expect(io.writes).toEqual([artifactPath('/fastReader', '人类简史|尤瓦尔', 'study')])
    const parsed = await loadArtifact<{ v: number }>('study', ctx)
    expect(parsed?.status).toBe('ok')
    if (parsed?.status !== 'ok') return
    expect(parsed.env.data).toEqual({ v: 1 })
    expect(parsed.env.updatedAt).toBe(500)
  })

  it('读不到就是 null，不抛也不报错', async () => {
    expect(await loadArtifact('notes', ctxOf(new FakeIO(), '书|人'))).toBeNull()
  })

  it('网络读取失败只是警告，不打断调用方', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    io.throwOnRead = true
    expect(await loadArtifact('quiz', ctxOf(io, '书|人'))).toBeNull()
    warn.mockRestore()
  })

  it('写失败返回 false，发生在 IO 层的不写也不抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    io.failWrite = true
    expect(await saveArtifact(sample({}), ctxOf(io, '书|人'))).toBe(false)
    warn.mockRestore()
  })

  it('云端信封版本更高时放弃覆盖', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    const ctx = ctxOf(io, '书|人')
    const known = { status: 'newer', schema: ARTIFACT_SCHEMA + 1 } as const
    expect(await saveArtifact(sample({}), ctx, known)).toBe(false)
    expect(io.writes).toEqual([])
    warn.mockRestore()
  })

  it('读不懂 / 这一轮没读成同样不许覆盖：否则一次网络抖动会盖掉别的设备的新副本', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const io = new FakeIO()
    const ctx = ctxOf(io, '书|人')
    expect(await saveArtifact(sample({}), ctx, { status: 'bad', reason: 'invalid-json' })).toBe(false)
    expect(await saveArtifact(sample({}), ctx, { status: 'error', error: new Error('boom') })).toBe(false)
    // missing 是「确知云端没有」：这时才允许写上去（路径取信封自带的 bookKey）
    expect(await saveArtifact(sample({}), ctx, { status: 'missing' })).toBe(true)
    expect(io.writes).toEqual([artifactPath('/fastReader', '人类简史|尤瓦尔', 'study')])
    warn.mockRestore()
  })

  it('loadArtifactResult 区分「云端没有」与「读失败」，老接口语义不变', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = new FakeIO()
    expect(await loadArtifactResult('study', ctxOf(missing, '书|人'))).toEqual({ status: 'missing' })
    expect(await loadArtifact('study', ctxOf(missing, '书|人'))).toBeNull()

    const broken = new FakeIO()
    broken.throwOnRead = true
    const failed = await loadArtifactResult('study', ctxOf(broken, '书|人'))
    expect(failed.status).toBe('error')
    expect(await loadArtifact('study', ctxOf(broken, '书|人'))).toBeNull()

    // 没有同步上下文（没配 WebDAV）也按「没读成」处理，不能当成「云端没有」
    expect((await loadArtifactResult('study', null)).status).toBe('missing')
    warn.mockRestore()
  })
})
