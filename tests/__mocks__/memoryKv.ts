/**
 * 内存版 KV：模拟 Cloudflare Workers KV 的最小接口（get / put / delete）。
 * 只实现测试需要的语义：按 key 存字符串、expirationTtl 忽略。
 */
export interface MemoryKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  /** 测试用：当前所有键 */
  __keys(): string[]
}

export function createMemoryKV(): MemoryKV {
  const store = new Map<string, string>()
  return {
    async get(key) {
      return store.has(key) ? store.get(key)! : null
    },
    async put(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
    __keys() {
      return [...store.keys()]
    },
  }
}

/** 构造一个 Functions 需要的 env */
export function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    FASTREADER_KV: createMemoryKV(),
    ...overrides,
  }
}
