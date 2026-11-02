import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './demo.css'
import '@/i18n'
import { ThemeProvider } from '@/components/ThemeProvider'
import { UnifiedStatusBar } from '@/components/UnifiedStatusBar'
import { FileUploadCard } from '@/components/sections/FileUploadCard'
import { BookTooltipBody } from '@/components/library/BookInfo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { LibraryEntry } from '@/services/library/types'

// 三处 UI 改动的真实浏览器验收页：状态栏分组 / 云端缓存卡片与操作行 / 悬浮卡完整 metadata + 滚动
const noop = () => {}
const long =
  'This is a kind of economy and management book. As outstanding expert in investment field, John Neff manages Windson for more than 30 years. During this period, Windsons investment record is excellent: he beat the market in 22 of 31 years. This book is the summary of his investing experience and discipline: low price-earnings ratio, fundamental growth, dividend yield, and the courage to be contrarian when the crowd is wrong. He also explains how to read annual reports, when to sell a stock, and why patience matters more than cleverness in the long run.'
const entry = {
  path: '约翰·聂夫的成功投资.epub',
  title: '约翰·聂夫的成功投资',
  author: '[美] 约翰·聂夫',
  year: 2015,
  subjects: ['商业', '传记', '经济', '投资', '历史', '管理'],
  desc: long,
  readProgress: { pct: 37 },
  size: 1.2 * 1024 * 1024,
  chapterCount: 6,
  mtime: '',
  status: 'unprocessed',
  stale: false,
  missingScans: 0,
  updatedAt: 0,
} as unknown as LibraryEntry

const meta = { processedAt: '2026-11-01T22:55:39Z', model: 'claude-opus-5-5', chapterCount: 12 } as never
const q = new URLSearchParams(location.search)
const costly = q.get('cost') === '1'
const onlyTooltip = q.get('only') === 'tooltip' // 只渲染悬浮卡：让它直接出现在视口里

/** 上传卡包一层 state：拖入 / 选择的文件真的会显示出来，才能验证落笔区的拖入路径 */
export function UploadDemo() {
  const [file, setFile] = useState<File | null>(q.get('file') === '1' ? new File([new Uint8Array(1.2 * 1024 * 1024)], '约翰·聂夫的成功投资.epub') : null)
  return (
    <FileUploadCard
      file={file}
      processing={false}
      extractingChapters={false}
      isCheckingCloudCache={false}
      cloudCacheMetadata={costly ? ({ ...(meta as object), costUSD: 0.1234, costRMB: 0.89 } as never) : ({ ...(meta as object), costUSD: 0, costRMB: 0 } as never)}
      cloudCacheContent="# x"
      cloudChartsFileFound
      cloudCacheIsPartial={q.get('partial') === '1'}
      webdavEnabled
      webdavInitialized
      onFileSelect={setFile}
      onExtractChapters={noop}
      onClearCache={noop}
      onOpenWebDAVBrowser={noop}
      onLoadFromCloudCache={noop}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme={(q.get('theme') as 'light' | 'dark') || 'light'} storageKey="ui-demo-theme">
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }} className="space-y-8">
      {!onlyTooltip && (
      <section data-demo="statusbar">
        <h2 className="t-label mb-2 text-muted-foreground">状态栏：三阶段切换（书库 · 设置 · 处理），分别停在三个阶段</h2>
        <div className="space-y-1">
          <UnifiedStatusBar currentView="config" configSections configSection="library" onSelectConfigSection={noop} onToggleView={noop} />
          <UnifiedStatusBar currentView="config" configSections configSection="process" onSelectConfigSection={noop} onToggleView={noop} />
          <UnifiedStatusBar currentView="processing" configSections configSection="process" onSelectConfigSection={noop} onToggleView={noop} />
        </div>
      </section>
      )}

      {!onlyTooltip && (
      <section data-demo="upload">
        <UploadDemo />
      </section>
      )}

      <section data-demo="tooltip" style={{ paddingTop: q.get('hover') === '1' ? 230 : onlyTooltip ? 440 : 460 }}>
        <h2 className="t-label mb-2 text-muted-foreground">悬浮卡（强制展开）</h2>
        <Tooltip open={q.get('hover') === '1' ? undefined : true}>
          <TooltipTrigger asChild>
            <button type="button" className="rounded-md border px-3 py-2 text-sm">书卡（悬浮卡在其上方）</button>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-popover text-popover-foreground shadow-md ring-1 ring-border">
            <BookTooltipBody entry={entry} />
          </TooltipContent>
        </Tooltip>
      </section>
    </div>
  </ThemeProvider>,
)
