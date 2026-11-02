#!/usr/bin/env node
/**
 * 批量修复「扁平目录」EPUB：把 toc.ncx / nav.xhtml 里摊平的目录按推断出的层级重写成嵌套结构。
 *
 * 与应用内 `epubProcessor.restructureFlatToc` 用同一份算法（直接 import src/services/epub/tocOutline.ts，
 * 需要 Node >= 22.6 的 type stripping，本仓库用 Node 24），所以脚本产物与「打开书时现场还原」的结果一致。
 * 只改目录文件（ncx / nav），正文与其它文件逐字节保留；原文件不动，产物写到 --out。
 *
 * 用法（项目根目录）：
 *   node scripts/fix_flat_toc.mjs --src <epub 目录> --out <输出目录> [--llm] [--only 子串] [--limit N] [--dry]
 *
 *   --llm   算法拿不准的书请 LLM 判层级（OpenAI 兼容网关，读 .env 的 VITE_TEST_LLM_BASE_URL / _API_KEY / _MODEL，不打印）；
 *           不加则这类书标记为 needs-llm 并跳过
 *   --cache <file>  LLM 判出的层级落盘缓存（按标题序列哈希），重跑不重复调用
 *   --dry   只出报告不写文件
 *
 * 产物：<out>/<原文件名> 与 <out>/_report.json（每本书的状态、条目数、层级分布）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import JSZip from 'jszip'
import { inferOutline, buildOutlineTree, refineWithLlm, validateLevels } from '../src/services/epub/tocOutline.ts'

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const flag = (name) => argv.includes(`--${name}`)
const SRC = opt('src')
const OUT = opt('out')
const ONLY = opt('only', '')
const LIMIT = Number(opt('limit', '0')) || Infinity
const USE_LLM = flag('llm')
const DRY = flag('dry')
if (!SRC || !OUT) {
  console.error('缺少 --src / --out')
  process.exit(2)
}

// ---------- LLM（只读 .env，绝不打印密钥） ----------
function loadEnv() {
  const env = {}
  const file = path.resolve('.env')
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}
const ENV = loadEnv()
const PROMPT = fs.readFileSync(path.resolve('src/services/prompts/config/toc-levels.md'), 'utf8')

async function askLlm(entries, prior) {
  const base = (ENV.VITE_TEST_LLM_BASE_URL || '').replace(/\/+$/, '')
  if (!base || !ENV.VITE_TEST_LLM_API_KEY || !ENV.VITE_TEST_LLM_MODEL) throw new Error('.env 缺 VITE_TEST_LLM_*')
  // 与应用端 renderPrompt 同语义：占位符整体替换
  const prompt = PROMPT.replace('{{prior}}', JSON.stringify(prior)).replace('{{entries}}', JSON.stringify(entries))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ENV.VITE_TEST_LLM_API_KEY}` },
        body: JSON.stringify({ model: ENV.VITE_TEST_LLM_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
        signal: AbortSignal.timeout(240_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = (await res.json())?.choices?.[0]?.message?.content ?? ''
      const m = text.match(/\{[\s\S]*\}/)
      const levels = m ? JSON.parse(m[0]).levels : []
      return (Array.isArray(levels) ? levels : []).filter((l) => Number.isInteger(l?.id) && Number.isInteger(l?.level))
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
  return []
}

// ---------- 目录文件解析 / 重写 ----------
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** toc.ncx：只处理「完全扁平」的 navMap（navPoint 不嵌套）。返回 { entries:[{block,label,href}], head, tail } */
function parseNcx(xml) {
  const mapStart = xml.search(/<navMap\b[^>]*>/)
  const mapEnd = xml.lastIndexOf('</navMap>')
  if (mapStart < 0 || mapEnd < 0) return null
  const openTag = xml.match(/<navMap\b[^>]*>/)[0]
  const innerStart = mapStart + openTag.length
  const inner = xml.slice(innerStart, mapEnd)
  const entries = []
  let cursor = 0
  const re = /<navPoint\b[\s\S]*?<\/navPoint>/g
  let m
  while ((m = re.exec(inner))) {
    const block = m[0]
    if ((block.match(/<navPoint\b/g) || []).length !== 1) return null // 已有嵌套
    const label = stripTags((block.match(/<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>/) || [, ''])[1])
    const href = decode((block.match(/<content\b[^>]*\bsrc="([^"]*)"/) || [, ''])[1])
    entries.push({ block, label, href })
    cursor = m.index + block.length
  }
  if (!entries.length || inner.slice(cursor).replace(/\s+/g, '') !== '') return null // navMap 里还有别的内容
  return { entries, head: xml.slice(0, innerStart), tail: xml.slice(mapEnd) }
}

function renderNcx(parsed, roots) {
  const render = (node, depth) => {
    const e = parsed.entries[node.id]
    const kids = (node.subitems || []).map((k) => render(k, depth + 1)).join('\n')
    if (!kids) return e.block
    const at = e.block.lastIndexOf('</navPoint>')
    return `${e.block.slice(0, at)}\n${kids}\n${' '.repeat(depth * 2)}${e.block.slice(at)}`
  }
  return `${parsed.head}\n${roots.map((r) => render(r, 0)).join('\n')}\n${parsed.tail}`
}

/** nav.xhtml：处理 epub:type="toc" 的 nav 里完全扁平的 <ol><li><a/></li></ol> */
function parseNav(xml) {
  const nav = [...xml.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].find((m) => /epub:type\s*=\s*"[^"]*\btoc\b[^"]*"/.test(m[0].slice(0, m[0].indexOf('>') + 1)))
  if (!nav) return null
  const navText = nav[0]
  const olStart = navText.search(/<ol\b[^>]*>/)
  const olEnd = navText.lastIndexOf('</ol>')
  if (olStart < 0 || olEnd < 0) return null
  const olOpen = navText.match(/<ol\b[^>]*>/)[0]
  const inner = navText.slice(olStart + olOpen.length, olEnd)
  if (/<ol\b/.test(inner)) return null // 已有嵌套
  const entries = []
  let cursor = 0
  const re = /<li\b[^>]*>[\s\S]*?<\/li>/g
  let m
  while ((m = re.exec(inner))) {
    const block = m[0]
    const a = block.match(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/)
    if (!a) return null
    entries.push({ block, label: stripTags(a[2]), href: decode(a[1]) })
    cursor = m.index + block.length
  }
  if (!entries.length || inner.slice(cursor).replace(/\s+/g, '') !== '') return null
  const navStart = nav.index
  return {
    entries,
    head: xml.slice(0, navStart) + navText.slice(0, olStart + olOpen.length),
    tail: navText.slice(olEnd) + xml.slice(navStart + navText.length),
  }
}

function renderNav(parsed, roots) {
  const render = (node) => {
    const e = parsed.entries[node.id]
    const kids = (node.subitems || []).map(render).join('\n')
    if (!kids) return e.block
    const at = e.block.lastIndexOf('</li>')
    return `${e.block.slice(0, at)}\n<ol style="list-style-type:none;">\n${kids}\n</ol>\n${e.block.slice(at)}`
  }
  return `${parsed.head}\n${roots.map(render).join('\n')}\n${parsed.tail}`
}

// ---------- 层级判定（与 epubProcessor.restructureFlatToc 同顺序） ----------
const levelCache = new Map()
// LLM 结果落盘（按标题序列的哈希），重跑 / 换输入目录时不重复花钱
const CACHE_FILE = opt('cache', '')
const diskCache = CACHE_FILE && fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}
const keyOf = (labels) => crypto.createHash('sha256').update(labels.join('\n')).digest('hex').slice(0, 24)
async function decideLevels(labels) {
  const key = labels.join('\n')
  if (levelCache.has(key)) return levelCache.get(key)
  const dk = keyOf(labels)
  if (diskCache[dk]?.levels) {
    const inferred = inferOutline(labels)
    const r = { levels: diskCache[dk].levels, how: 'llm(cache)', inferred }
    levelCache.set(key, r)
    return r
  }
  const inferred = inferOutline(labels)
  let levels = null
  let how = 'none'
  if (inferred.llmCandidate) {
    if (USE_LLM) {
      try {
        levels = await refineWithLlm(labels, askLlm)
        if (levels) how = 'llm'
      } catch (e) {
        how = `llm-error:${e.message}`
      }
    } else {
      how = 'needs-llm'
    }
  }
  if (!levels && inferred.levels && (inferred.confident || inferred.applyWithoutLlm)) {
    levels = inferred.levels
    how = how.startsWith('llm-error') ? `${how}->algo` : 'algo'
  }
  const result = { levels, how, inferred }
  levelCache.set(key, result)
  if (CACHE_FILE && how === 'llm' && levels) {
    diskCache[dk] = { levels }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(diskCache))
  }
  return result
}

const rootsOf = (labels, hrefs, levels) =>
  buildOutlineTree(
    labels.map((label, i) => ({ id: i, label, href: hrefs[i] })),
    levels,
  )

// ---------- 单本处理 ----------
async function processBook(file) {
  const buf = fs.readFileSync(path.join(SRC, file))
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1]
  if (!opfPath || !zip.file(opfPath)) return { file, status: 'skip', reason: 'no-opf' }
  const opf = await zip.file(opfPath).async('string')
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const items = [...opf.matchAll(/<item\b[^>]*>/g)].map((m) => m[0])
  const attr = (tag, name) => decode((tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [, ''])[1])
  const navItem = items.find((t) => /\bnav\b/.test(attr(t, 'properties')))
  const ncxItem = items.find((t) => attr(t, 'media-type') === 'application/x-dtbncx+xml')
  const targets = []
  if (navItem) targets.push({ kind: 'nav', path: decodeURI(base + attr(navItem, 'href')) })
  if (ncxItem) targets.push({ kind: 'ncx', path: decodeURI(base + attr(ncxItem, 'href')) })
  if (!targets.length) return { file, status: 'skip', reason: 'no-toc-file' }

  const outFiles = {}
  const detail = []
  for (const t of targets) {
    const entry = zip.file(t.path)
    if (!entry) {
      detail.push({ kind: t.kind, status: 'skip', reason: 'missing-file' })
      continue
    }
    const xml = await entry.async('string')
    const parsed = t.kind === 'nav' ? parseNav(xml) : parseNcx(xml)
    if (!parsed) {
      detail.push({ kind: t.kind, status: 'skip', reason: 'not-flat-or-unparsable' })
      continue
    }
    const labels = parsed.entries.map((e) => e.label)
    if (labels.length < 10) {
      detail.push({ kind: t.kind, status: 'skip', reason: `entries<10 (${labels.length})` })
      continue
    }
    const { levels, how, inferred } = await decideLevels(labels)
    if (!levels || !validateLevels(levels)) {
      detail.push({ kind: t.kind, status: how === 'needs-llm' ? 'needs-llm' : 'keep-flat', how, entries: labels.length })
      continue
    }
    const roots = rootsOf(labels, parsed.entries.map((e) => e.href), levels)
    if (!roots) {
      detail.push({ kind: t.kind, status: 'keep-flat', how: `${how}:tree-null`, entries: labels.length })
      continue
    }
    const rewritten = t.kind === 'nav' ? renderNav(parsed, roots) : renderNcx(parsed, roots)
    // 自检：重写后重新解析，条目顺序 / 标题 / href 必须与原来逐项一致
    const reparsed = t.kind === 'nav' ? parseNavAny(rewritten) : parseNcxAny(rewritten)
    const same =
      reparsed.length === parsed.entries.length &&
      reparsed.every((e, i) => e.label === parsed.entries[i].label && e.href === parsed.entries[i].href)
    if (!same) {
      detail.push({ kind: t.kind, status: 'error', reason: 'self-check-failed' })
      continue
    }
    outFiles[t.path] = rewritten
    const dist = {}
    for (const l of levels) dist[l] = (dist[l] || 0) + 1
    detail.push({ kind: t.kind, status: 'fixed', how, entries: labels.length, levelDist: dist, chapters: roots.filter((r) => !(levels[r.id] <= 0)).length, confident: inferred.confident })
  }

  if (!Object.keys(outFiles).length) {
    const primary = detail.find((d) => d.status !== 'skip') || detail[0]
    return { file, status: primary?.status ?? 'skip', detail }
  }
  if (!DRY) {
    for (const [p, content] of Object.entries(outFiles)) zip.file(p, content)
    if (zip.file('mimetype')) zip.file('mimetype', await zip.file('mimetype').async('string'), { compression: 'STORE' })
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, file), out)
  }
  return { file, status: 'fixed', detail, nameCount: names.length }
}

// 自检用：从重写后的文本里按文档顺序取出全部条目（不要求扁平）
function parseNcxAny(xml) {
  return [...xml.matchAll(/<navPoint\b[\s\S]*?<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>\s*<content\b[^>]*\bsrc="([^"]*)"/g)].map((m) => ({ label: stripTags(m[1]), href: decode(m[2]) }))
}
function parseNavAny(xml) {
  const nav = [...xml.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].find((m) => /epub:type\s*=\s*"[^"]*\btoc\b/.test(m[0].slice(0, m[0].indexOf('>') + 1)))
  if (!nav) return []
  return [...nav[0].matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ label: stripTags(m[2]), href: decode(m[1]) }))
}

// ---------- 主流程 ----------
const files = fs
  .readdirSync(SRC)
  .filter((f) => f.toLowerCase().endsWith('.epub') && f.includes(ONLY))
  .sort()
const report = []
let done = 0
const queue = files.slice()
const stats = {}
async function worker() {
  while (queue.length) {
    const file = queue.shift()
    if (report.filter((r) => r.status === 'fixed').length >= LIMIT) return
    let r
    try {
      r = await processBook(file)
    } catch (e) {
      r = { file, status: 'error', reason: String(e?.message || e) }
    }
    report.push(r)
    stats[r.status] = (stats[r.status] || 0) + 1
    done++
    if (done % 50 === 0) console.log(`... ${done}/${files.length}`, JSON.stringify(stats))
  }
}
// 先串行处理（LLM 并发由书间并行承担，批量时可调大）
const CONC = USE_LLM ? 3 : 1
await Promise.all(Array.from({ length: CONC }, worker))
report.sort((a, b) => a.file.localeCompare(b.file, 'zh'))
if (!DRY) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify({ at: new Date().toISOString(), src: SRC, llm: USE_LLM, stats, report }, null, 2))
}
console.log('完成', JSON.stringify(stats))
