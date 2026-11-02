import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/i18n'
import { mount, click, findButton, flush, typeInto, pressKey, type Mounted } from './uiTestUtils'
import { ErrorBoundary, isChunkLoadError } from '../src/components/ErrorBoundary'
import { UnifiedStatusBar } from '../src/components/UnifiedStatusBar'
import { ChapterSelectionSection } from '../src/components/sections/ChapterSelectionSection'
import { ViewContentDialog } from '../src/components/ViewContentDialog'
import { AIProviderConfig } from '../src/components/project/AIProviderConfig'
import { CloudCacheSection } from '../src/components/sections/CloudCacheSection'
import i18n from '../src/i18n'

// Radix 弹层 + 多步异步交互：全量并行跑时单测可能超过默认 5s（与 w2uiConfig 同一处理）
vi.setConfig({ testTimeout: 30000 })

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

describe('ErrorBoundary 局部边界与 chunk 失效识别', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errorSpy.mockRestore())

  it('isChunkLoadError 识别 Vite/webpack/Safari 三种形态', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'))).toBe(true)
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('普通错误'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('section 边界内联展示错误，「重试」后恢复渲染', () => {
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('图表炸了')
      return <p>恢复正常</p>
    }
    m = mount(
      <div>
        <p>外部内容</p>
        <ErrorBoundary section="关键图表">
          <Flaky />
        </ErrorBoundary>
      </div>
    )
    expect(m.container.textContent).toContain('外部内容')
    expect(m.container.textContent).toContain(i18n.t('errorBoundary.sectionFailed', { section: '关键图表' }))
    expect(m.container.textContent).toContain('图表炸了')

    shouldThrow = false
    click(findButton(i18n.t('errorBoundary.retry')))
    expect(m.container.textContent).toContain('恢复正常')
  })

  it('lazy chunk 加载失败时提示刷新页面且不提供重试', async () => {
    const Lazy = (await import('react')).lazy(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/ResultsSection-old.js'))
    )
    const { Suspense } = await import('react')
    m = mount(
      <ErrorBoundary section="结果区">
        <Suspense fallback={<p>加载中</p>}>
          <Lazy />
        </Suspense>
      </ErrorBoundary>
    )
    await flush(5)
    expect(m.container.textContent).toContain(i18n.t('errorBoundary.chunkHint'))
    expect(findButton(i18n.t('errorBoundary.reload'))).toBeTruthy()
    expect(findButton(i18n.t('errorBoundary.retry'))).toBeUndefined()
  })
})

describe('UnifiedStatusBar 中止二次确认', () => {
  it('处理中点「设置」先弹确认，确认后才中止，并切到设置这一段', () => {
    const onAbortToConfig = vi.fn()
    const onToggleView = vi.fn()
    const onSelect = vi.fn()
    m = mount(
      <UnifiedStatusBar
        currentView="processing"
        processing
        progress={30}
        onToggleView={onToggleView}
        onSelectConfigSection={onSelect}
        onAbortToConfig={onAbortToConfig}
        onCancelProcessing={vi.fn()}
      />
    )
    click(findButton(new RegExp(`^${i18n.t('statusBar.settings')}$`)))
    expect(onAbortToConfig).not.toHaveBeenCalled()
    expect(onToggleView).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled() // 确认之前什么都不动
    expect(document.body.textContent).toContain(i18n.t('progress.confirmAbortToConfigTitle'))

    click(findButton(i18n.t('progress.abortAndEditSettings')))
    expect(onAbortToConfig).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('process')
  })

  it('处理中点「设置」后取消确认：不中止、也不切段', () => {
    const onAbortToConfig = vi.fn()
    const onSelect = vi.fn()
    m = mount(<UnifiedStatusBar currentView="processing" processing progress={30} onSelectConfigSection={onSelect} onAbortToConfig={onAbortToConfig} onCancelProcessing={vi.fn()} />)
    click(findButton(new RegExp(`^${i18n.t('statusBar.settings')}$`)))
    click(findButton(i18n.t('common.cancel')))
    expect(onAbortToConfig).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('「中止」按钮取消确认时不中止', () => {
    const onCancel = vi.fn()
    m = mount(<UnifiedStatusBar currentView="processing" processing progress={10} onCancelProcessing={onCancel} />)
    click(findButton(i18n.t('progress.abort')))
    expect(document.body.textContent).toContain(i18n.t('progress.confirmAbortTitle'))
    click(findButton(i18n.t('common.cancel')))
    expect(onCancel).not.toHaveBeenCalled()

    click(findButton(i18n.t('progress.abort')))
    const confirmBtns = Array.from(document.querySelectorAll('[role="alertdialog"] button')).filter(
      (b) => b.textContent === i18n.t('progress.abort')
    )
    click(confirmBtns[0])
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('非处理中切换视图不弹确认', () => {
    const onToggleView = vi.fn()
    m = mount(<UnifiedStatusBar currentView="processing" onToggleView={onToggleView} onAbortToConfig={vi.fn()} />)
    click(findButton(new RegExp(`^${i18n.t('statusBar.settings')}$`)))
    expect(onToggleView).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})

describe('ChapterSelectionSection 批量选择', () => {
  // Radix Slider 依赖 ResizeObserver，jsdom 未提供
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  const chapters = [
    { id: 'a', title: '短章', content: 'x'.repeat(100) },
    { id: 'b', title: '中章', content: 'x'.repeat(2000) },
    { id: 'c', title: '长章', content: 'x'.repeat(5000) },
  ]

  it('切到「按字符数筛选」一次性 setSelection，而不是 1 次清空 + N 次单选', () => {
    const onSetSelection = vi.fn()
    const onChapterSelect = vi.fn()
    const onSelectAll = vi.fn()
    m = mount(
      <ChapterSelectionSection
        extractedChapters={chapters}
        bookData={{ title: 'T', author: 'A' }}
        selectedChapters={new Set(['a', 'b', 'c'])}
        customPrompt=""
        processing={false}
        extractingChapters={false}
        onChapterSelect={onChapterSelect}
        onSelectAll={onSelectAll}
        onSetSelection={onSetSelection}
        onCustomPromptChange={vi.fn()}
        onViewChapterContent={vi.fn()}
        onStartProcessing={vi.fn()}
      />
    )
    click(m.container.querySelector('#char-filter'))
    expect(onSetSelection).toHaveBeenCalledTimes(1)
    // 阈值初始化为最小字符数：全部满足
    expect(onSetSelection).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(onChapterSelect).not.toHaveBeenCalled()
    expect(onSelectAll).not.toHaveBeenCalled()
  })

  it('查看原文的纯图标按钮有可读名称', () => {
    m = mount(
      <ChapterSelectionSection
        extractedChapters={chapters}
        bookData={null}
        selectedChapters={new Set()}
        customPrompt=""
        processing={false}
        extractingChapters={false}
        onChapterSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onSetSelection={vi.fn()}
        onCustomPromptChange={vi.fn()}
        onViewChapterContent={vi.fn()}
        onStartProcessing={vi.fn()}
      />
    )
    const labels = Array.from(m.container.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label'))
    expect(labels).toContain(i18n.t('chapters.viewChapterContent', { title: '长章' }))
  })
})

describe('ViewContentDialog HTML 净化', () => {
  it('html 内容写入 DOM 前去掉脚本与事件属性', () => {
    m = mount(
      <ViewContentDialog
        title="章"
        chapterIndex={0}
        contentType="html"
        content={'<p>正文</p><img src="x" onerror="window.__xss=1"><script>window.__xss=2</script>'}
      />
    )
    const trigger = m.container.querySelector('button[aria-label]')
    expect(trigger?.getAttribute('aria-label')).toBe(i18n.t('viewContent.originalText'))
    click(trigger)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('正文')
    expect(dialog.innerHTML).not.toContain('onerror')
    expect(dialog.querySelector('script')).toBeNull()
  })
})

describe('AIProviderConfig 编辑子对话框未保存确认', () => {
  it('有改动时关闭先确认，「继续编辑」保留表单；无改动直接关闭', async () => {
    m = mount(<AIProviderConfig />)
    click(findButton(i18n.t('aiProvider.add')))
    expect(document.body.textContent).toContain(i18n.t('aiProvider.createTitle'))

    // 无改动：取消直接关闭
    click(findButton(i18n.t('common.cancel')))
    expect(document.body.textContent).not.toContain(i18n.t('aiProvider.createTitle'))

    // 新建分两步：先选服务商预设（选「OpenAI 兼容」），再进凭据页
    click(findButton(i18n.t('aiProvider.add')))
    click(findButton(new RegExp(i18n.t('aiProvider.wizard.fixed.openai'))))
    expect(document.body.textContent).toContain(i18n.t('aiProvider.wizard.step2'))
    const keyInput = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!
    typeInto(keyInput, 'sk-test')
    click(findButton(i18n.t('common.cancel')))
    expect(document.body.textContent).toContain(i18n.t('aiProvider.discardTitle'))

    click(findButton(i18n.t('aiProvider.keepEditing')))
    expect(document.body.textContent).toContain(i18n.t('aiProvider.createTitle'))
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')?.value).toBe('sk-test')

    // Esc 关闭同样拦截
    pressKey(document.querySelector('[role="dialog"]')!, 'Escape')
    await flush()
    expect(document.body.textContent).toContain(i18n.t('aiProvider.discardTitle'))
    click(findButton(i18n.t('aiProvider.discard')))
    await flush()
    expect(document.body.textContent).not.toContain(i18n.t('aiProvider.createTitle'))
  })
})

describe('CloudCacheSection 云缓存状态提示', () => {
  const base = {
    isCheckingCloudCache: false,
    cloudCacheContent: null,
    file: new File(['x'], 'a.epub'),
    webdavEnabled: true,
    webdavInitialized: true,
    onLoadFromCloudCache: vi.fn(),
  }

  it('状态未知时提示「无法确认」而不是「无缓存」', () => {
    m = mount(<CloudCacheSection {...base} cloudCacheMetadata={null} cloudCacheStatusUnknown />)
    expect(m.container.textContent).toContain(i18n.t('cloudCache.statusUnknown'))
    expect(m.container.textContent).not.toContain(i18n.t('cloudCache.noCache'))
  })

  it('缓存不完整时标注', () => {
    m = mount(
      <CloudCacheSection
        {...base}
        cloudCacheContent="# x"
        cloudCacheMetadata={{ processedAt: new Date().toISOString(), model: 'm', chapterCount: 3 } as never}
        cloudCacheIsPartial
      />
    )
    expect(m.container.textContent).toContain(i18n.t('cloudCache.partialLoaded'))
  })

  const found = (extra: Record<string, unknown> = {}) =>
    mount(
      <CloudCacheSection
        {...base}
        cloudCacheContent="# x"
        cloudCacheMetadata={{ processedAt: '2026-11-01T22:55:39Z', model: 'claude-opus-5-5', chapterCount: 12, ...extra } as never}
      />
    )

  it('费用为 0 时不会把数字 0 渲染到页面上（`costUSD && …` 的老坑）', () => {
    m = found({ costUSD: 0, costRMB: 0 })
    const dl = m.container.querySelector('dl')!
    // 游离的 0 是 <dl> 里的一个文本节点（夹在两行之间），不是元素：直接断言子节点全是元素
    expect(Array.from(dl.childNodes).every((n) => n.nodeType === Node.ELEMENT_NODE)).toBe(true)
    expect(dl.textContent).not.toContain(i18n.t('cloudCache.cost')) // 0 费用整行不显示
  })

  it('有费用时多一枚费用标签；元数据是「标签 值」药丸（dl），处理时间是标题下的副标题，主操作在标题行', () => {
    m = found({ costUSD: 0.1234, costRMB: 0.89 })
    const dl = m.container.querySelector('dl')!
    expect(dl.textContent).toContain('$0.1234 / ¥0.89')
    const labels = Array.from(dl.querySelectorAll('dt')).map((d) => d.textContent)
    expect(labels).toEqual([i18n.t('cloudCache.model'), i18n.t('cloudCache.chapterCount'), i18n.t('cloudCache.cost')])
    expect(m.container.textContent).toContain(new Date('2026-11-01T22:55:39Z').toLocaleString()) // 处理时间仍显示（在副标题里）
    const btn = Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent === i18n.t('cloudCache.useCache'))!
    expect(dl.contains(btn)).toBe(false) // 不在元数据列表里
    expect(btn.className).not.toContain('w-full') // 不再整行铺开
    click(btn)
    expect(base.onLoadFromCloudCache).toHaveBeenCalled()
  })
})
