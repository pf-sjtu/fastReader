/**
 * 书 id：由文件名主干归一后求 64 位 FNV-1a，保证「同名书」在任何设备 / 脚本里得到同一个 id。
 * 与预处理脚本 scripts/covers_prepare.py 的 book_id 逐字节等价，契约样例：tests/fixtures/book-id-cases.json。
 */

/** 去目录与扩展名：`/a/b/书名 - 作者.epub` → `书名 - 作者` */
export function bookStem(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, '')
}

/** NFKC → 小写 → 去掉所有空白 / 标点 / 符号 / 控制字符（全角半角、括号引号差异不影响匹配） */
export function normalizeStem(stem: string): string {
  return stem.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, '')
}

const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

export function bookIdOf(pathOrName: string): string {
  let h = OFFSET
  for (const byte of new TextEncoder().encode(normalizeStem(bookStem(pathOrName)))) {
    h = ((h ^ BigInt(byte)) * PRIME) & MASK
  }
  return `bk_${h.toString(36)}`
}
