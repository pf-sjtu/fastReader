// 秘密字段（API Key / WebDAV 密码）的脱敏与合并
// 约定：客户端永远只看到 `{ hasSecret: boolean }`；写入时
//   字段缺席或 `{hasSecret: 任意}` → 保留服务端原值
//   字符串                        → 覆盖
//   null                          → 删除

export const SECRET_FIELD_NAMES = ['apiKey', 'password']

const isSecretRef = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value) && 'hasSecret' in value

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = clone(v)
    return out
  }
  return value
}

/** 深拷贝并把秘密字段替换为 `{hasSecret:true}` */
export function maskSecrets(data) {
  if (!data || typeof data !== 'object') return data
  const copy = clone(data)

  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (SECRET_FIELD_NAMES.includes(key)) {
        if (typeof value === 'string' && value.length > 0) node[key] = { hasSecret: true }
        else if (isSecretRef(value)) node[key] = { hasSecret: Boolean(value.hasSecret) }
        else if (value === null) delete node[key]
        continue
      }
      walk(value)
    }
  }

  walk(copy)
  return copy
}

function mergeNode(incoming, existing) {
  if (Array.isArray(incoming)) {
    const existingArr = Array.isArray(existing) ? existing : []
    // 带 id 的对象数组按 id 对齐：客户端可能重排服务商，按下标合并会把凭据配错对象
    const keyed = existingArr.length > 0 && existingArr.every((item) => item && typeof item === 'object' && typeof item.id === 'string')
    if (keyed) {
      const byId = new Map(existingArr.map((item) => [item.id, item]))
      return incoming.map((item) =>
        item && typeof item === 'object' && typeof item.id === 'string'
          ? mergeNode(item, byId.get(item.id))
          : item
      )
    }
    return incoming.map((item, index) => mergeNode(item, existingArr[index]))
  }
  if (!incoming || typeof incoming !== 'object') return incoming

  const existingObj = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const out = {}

  for (const [key, value] of Object.entries(incoming)) {
    if (SECRET_FIELD_NAMES.includes(key)) {
      if (typeof value === 'string') {
        if (value.length > 0) out[key] = value
        // 空字符串视为「不改」，保留服务端原值
        else if (existingObj[key] !== undefined) out[key] = existingObj[key]
      } else if (isSecretRef(value)) {
        if (existingObj[key] !== undefined) out[key] = existingObj[key]
      } else if (value === null) {
        // 显式清除：不写入该字段
      } else if (existingObj[key] !== undefined) {
        out[key] = existingObj[key]
      }
      continue
    }
    out[key] = mergeNode(value, existingObj[key])
  }

  // 客户端没提交的秘密字段继续沿用服务端值（避免部分更新误删凭据）
  for (const key of SECRET_FIELD_NAMES) {
    if (!(key in incoming) && existingObj[key] !== undefined) out[key] = existingObj[key]
  }

  return out
}

/** 把客户端提交的数据与服务端原值合并，秘密字段按「保留/覆盖/清除」规则处理 */
export function mergeSecrets(incoming, existing) {
  if (!incoming || typeof incoming !== 'object') return existing ?? {}
  return mergeNode(incoming, existing)
}
