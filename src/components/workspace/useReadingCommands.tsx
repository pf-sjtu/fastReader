/**
 * 阅读工作台的「命令层」：Ctrl/⌘+K 命令面板、j/k [ ] ? 快捷键、断点续读。
 * 把这些从 ReaderWorkspace 里拆出来，让它只关心布局。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EntityLinking } from '@/charts/linking/entityLinking'
import type { CompanionTab } from '@/stores/readingFocus'
import { useReadingFocusStore } from '@/stores/readingFocus'
import { adjacentChapter, cycleTab, libraryResumePoint, loadResume, resolveResume, resumeKeyOf, saveResume, type Command } from '@/reading/commands'
import { CommandPalette } from './CommandPalette'
import { syncLibraryProgress, useLibraryStore } from '@/services/library/libraryStore'
import { chapterReadOffset, resolveScrollContainer, scrollInsideChapter } from '@/utils/scrollTo'

interface Params {
  book: { title?: string; author?: string }
  chapters: readonly { id: string; title: string; summary?: string }[]
  processing: boolean
  currentChapterId: string
  navigateChapter: (id: string) => void
  expandChapter: (id: string) => void
  tabs: readonly { id: CompanionTab; label: string }[]
  activeTab: CompanionTab
  openTab: (tab: CompanionTab) => void
  linking: EntityLinking | null
  toggleFocusMode: () => void
  /** 源文件名：有且书库里有对应条目时，把阅读进度同步到书库（封面上的进度条） */
  fileName?: string | null
}

/** 输入框 / 对话框里不触发单键快捷键 */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('[role="dialog"]')
}

const PROGRESS_SYNC_MS = 5000

export function useReadingCommands(p: Params): { overlay: ReactNode; openPalette: () => void } {
  const { t } = useTranslation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const focusEntity = useReadingFocusStore((s) => s.focusEntity)

  const ids = useMemo(() => p.chapters.map((c) => c.id), [p.chapters])
  // 事件处理里要读最新值，又不想让监听器每次都重绑：放进 ref
  const live = useRef(p)
  live.current = p
  const idsRef = useRef(ids)
  idsRef.current = ids

  const goChapter = useCallback((id: string) => {
    live.current.expandChapter(id)
    live.current.navigateChapter(id)
  }, [])

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const cur = live.current
      if (e.key === 'j' || e.key === 'k') {
        const next = adjacentChapter(idsRef.current, cur.currentChapterId, e.key === 'j' ? 1 : -1)
        if (next) {
          e.preventDefault()
          goChapter(next)
        }
      } else if (e.key === '[' || e.key === ']') {
        const next = cycleTab(cur.tabs.map((x) => x.id), cur.activeTab, e.key === ']' ? 1 : -1)
        if (next) {
          e.preventDefault()
          cur.openTab(next)
        }
      } else if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goChapter])

  /* ---------- 断点续读：每本书只恢复一次，之后只保存 ---------- */
  const resumeKey = resumeKeyOf(p.book)
  const restoredFor = useRef<string | null>(null)
  const offsetTimer = useRef<number | null>(null)
  useEffect(() => () => { if (offsetTimer.current) window.clearTimeout(offsetTimer.current) }, [])
  const usableCount = p.chapters.filter((c) => !!c.summary).length
  useEffect(() => {
    if (p.processing || usableCount === 0 || restoredFor.current === resumeKey) return
    restoredFor.current = resumeKey
    // 本机续读点优先；没有（换设备 / 清了数据）时用书库索引里随 WebDAV 同步的阅读章节
    const name = live.current.fileName
    const entry = name ? Object.values(useLibraryStore.getState().index.entries).find((e) => e.path.split('/').pop() === name) : undefined
    const point = loadResume(resumeKey) ?? libraryResumePoint(entry?.readProgress)
    const target = resolveResume(point, p.chapters)
    // 已经在第一章（默认位置）且没有章内偏移就不用动
    const offset = point?.offset ?? 0
    if (target && (target !== p.chapters[0]?.id || offset > 0)) {
      if (target !== p.chapters[0]?.id) goChapter(target)
      // 章内位置：等 scrollToChapterWithRetry 的 200/400/600ms 三次对齐做完（折叠 / 懒渲染会让位置漂移）再往下读 offset 像素；
      // 期间用户若已翻到别章（currentChapterId 变了）就不拽回去
      if (offset > 0) {
        const timer = window.setTimeout(() => {
          if (live.current.currentChapterId === target) scrollInsideChapter(target, offset)
        }, 900)
        offsetTimer.current = timer
      }
    }
  }, [resumeKey, p.processing, usableCount, p.chapters, goChapter])
  useEffect(() => {
    if (p.processing || restoredFor.current !== resumeKey || !p.currentChapterId) return
    const index = idsRef.current.indexOf(p.currentChapterId)
    if (index < 0) return
    const timer = window.setTimeout(
      () => saveResume(resumeKey, { chapterId: p.currentChapterId, chapterIndex: index, chapterTitle: live.current.chapters[index]?.title ?? '', at: Date.now(), offset: chapterReadOffset(p.currentChapterId) }),
      600
    )
    return () => window.clearTimeout(timer)
  }, [resumeKey, p.currentChapterId, p.processing])
  // 同一章内滚动：停下 800ms 后更新章内偏移（换章由上面那条负责；这里只跟随滚动）
  useEffect(() => {
    if (p.processing) return
    const box = resolveScrollContainer()
    if (!box) return
    let timer: number | undefined
    const onScroll = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const cur = live.current
        const index = idsRef.current.indexOf(cur.currentChapterId)
        if (restoredFor.current !== resumeKey || index < 0) return
        saveResume(resumeKey, { chapterId: cur.currentChapterId, chapterIndex: index, chapterTitle: cur.chapters[index]?.title ?? '', at: Date.now(), offset: chapterReadOffset(cur.currentChapterId) })
      }, 800)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(timer)
      box.removeEventListener('scroll', onScroll)
    }
  }, [resumeKey, p.processing, usableCount])

  // 书库进度：停留 5 秒才写（快速翻章不写），且进度没变时服务层会跳过
  useEffect(() => {
    const name = live.current.fileName
    if (!name || p.processing || restoredFor.current !== resumeKey || !p.currentChapterId) return
    const index = idsRef.current.indexOf(p.currentChapterId)
    if (index < 0) return
    const timer = window.setTimeout(() => syncLibraryProgress(name, p.currentChapterId, ((index + 1) / idsRef.current.length) * 100), PROGRESS_SYNC_MS)
    return () => window.clearTimeout(timer)
  }, [resumeKey, p.currentChapterId, p.processing])

  /* ---------- 命令表 ---------- */
  const { chapters, linking, tabs, openTab, toggleFocusMode } = p
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    chapters.forEach((c, i) => {
      if (!c.summary) return
      list.push({ id: `ch-${c.id}`, group: 'chapter', label: c.title, hint: `${t('palette.group.chapter')} ${i + 1}`, run: () => goChapter(c.id) })
    })
    for (const prof of linking?.profiles.values() ?? []) {
      list.push({
        id: `en-${prof.id}`,
        group: 'entity',
        label: prof.name,
        keywords: prof.description,
        run: () => focusEntity(prof.id, { reveal: true, tab: 'graph' }),
      })
    }
    for (const tab of tabs) {
      list.push({ id: `tab-${tab.id}`, group: 'tab', label: tab.label, run: () => openTab(tab.id) })
    }
    list.push({ id: 'act-focus', group: 'action', label: t('palette.actions.focusMode'), hint: '\\', run: toggleFocusMode })
    list.push({ id: 'act-help', group: 'action', label: t('palette.actions.help'), hint: '?', run: () => setHelpOpen(true) })
    return list
  }, [chapters, linking, tabs, openTab, toggleFocusMode, goChapter, focusEntity, t])

  const keys: [string, string][] = [
    ['Ctrl / ⌘ + K', t('palette.keys.palette')],
    ['j / k', t('palette.keys.chapter')],
    ['[ / ]', t('palette.keys.tab')],
    ['\\', t('palette.keys.focus')],
    ['?', t('palette.keys.help')],
  ]
  const overlay = (
    <>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('palette.keys.title')}</DialogTitle>
            <DialogDescription>{t('palette.keys.description')}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-1.5 text-sm">
            {keys.map(([k, desc]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt>
                  <kbd className="rounded-md border bg-muted px-1.5 py-0.5 text-xs">{k}</kbd>
                </dt>
                <dd className="text-muted-foreground">{desc}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
  return { overlay, openPalette: () => setPaletteOpen(true) }
}
