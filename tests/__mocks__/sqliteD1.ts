/**
 * D1 形状的适配器，底下是 Node 内置的真 SQLite（node:sqlite）：SQL 语义（ON CONFLICT … WHERE、事务批处理、changes 计数）是真执行的，
 * 不是 mock。只实现 coversStore 用到的接口：prepare().bind().first()/all()/run()、batch()（一个事务）。
 * 每个方法都 await 一次，让并发调用在 await 点交错——和真实 D1 的「读与写之间会有别人插队」同构。
 */
// 不用静态 import：Vite 在 jsdom（client 环境）下会拒绝打包 `node:sqlite`（CI 的 Node 22 上实际报错）；运行时取内置模块不经过 Vite 的静态分析
const sqlite = process.getBuiltinModule('node:sqlite')
if (!sqlite) throw new Error('当前 Node 没有内置 node:sqlite（需要 Node ≥ 22.13）：D1 测试依赖它跑真 SQL')
const { DatabaseSync } = sqlite

type Param = string | number | null

export interface SqliteD1 {
  prepare(sql: string): Stmt
  batch(stmts: Stmt[]): Promise<{ results: Record<string, unknown>[]; meta: { changes: number } }[]>
  /** 测试用：直接对底层库执行 SQL（模拟「另一个写入者」） */
  __exec(sql: string, ...params: Param[]): void
  __all(sql: string, ...params: Param[]): Record<string, unknown>[]
  /** 测试用：执行过的语句 */
  __log: string[]
}

interface Stmt {
  sql: string
  params: Param[]
  bind(...p: Param[]): Stmt
  first(): Promise<Record<string, unknown> | null>
  all(): Promise<{ results: Record<string, unknown>[]; meta: { changes: number } }>
  run(): Promise<{ results: Record<string, unknown>[]; meta: { changes: number } }>
}

export function createSqliteD1(): SqliteD1 {
  const db = new DatabaseSync(':memory:')
  const log: string[] = []

  const exec = (sql: string, params: Param[]) => {
    log.push(sql)
    const st = db.prepare(sql)
    if (/^\s*select/i.test(sql)) return { results: st.all(...params) as Record<string, unknown>[], meta: { changes: 0 } }
    const r = st.run(...params)
    return { results: [], meta: { changes: Number(r.changes) } }
  }

  const make = (sql: string, params: Param[] = []): Stmt => ({
    sql,
    params,
    bind: (...p) => make(sql, p),
    async first() {
      await Promise.resolve()
      return exec(sql, params).results[0] ?? null
    },
    async all() {
      await Promise.resolve()
      return exec(sql, params)
    },
    async run() {
      await Promise.resolve()
      return exec(sql, params)
    },
  })

  return {
    prepare: (sql) => make(sql),
    async batch(stmts) {
      await Promise.resolve()
      db.exec('BEGIN')
      try {
        const out = stmts.map((s) => exec(s.sql, s.params))
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    __exec: (sql, ...params) => void db.prepare(sql).run(...params),
    __all: (sql, ...params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    __log: log,
  }
}
