// 提示词编辑器：内置模板只有 v2；只保存与默认不同的条目（覆盖项），未改动的条目跟随内置模板更新
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Info, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CopyButton } from '@/components/ui/copy-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { PromptConfig } from '../../types/ai'
import type { ProcessingOptions } from '../../stores/types'
import { useProcessingOptions } from '../../stores/configStore'
import { usePromptStore, type PromptPath } from '../../stores/prompts'
import { hasPromptOverrides, isPromptOverridden } from '../../services/prompts/overrides'
import { DEFAULT_PROMPT_VERSION } from '../../services/prompts/templates'
import { buildPromptPreview, type MindmapVariant, type PromptTab } from './promptPreview'

interface PromptEntry {
  /** 稳定 key，也用作 DOM id 后缀 */
  id: string
  tab: PromptTab
  path: PromptPath
  labelKey: string
  hintKey: string
  /** 模板可用的占位符（与 services/ai/promptInputs 的变量定义一致） */
  vars: string[]
  mindmap?: MindmapVariant
}

const CHAPTER_VARS = ['title', 'content']

const ENTRIES: PromptEntry[] = [
  { id: 'summary-fiction', tab: 'chapterSummary', path: { group: 'chapterSummary', key: 'fiction' }, labelKey: 'promptEditor.entries.fiction', hintKey: 'promptEditor.hints.fiction', vars: CHAPTER_VARS },
  { id: 'summary-nonfiction', tab: 'chapterSummary', path: { group: 'chapterSummary', key: 'nonFiction' }, labelKey: 'promptEditor.entries.nonFiction', hintKey: 'promptEditor.hints.nonFiction', vars: CHAPTER_VARS },
  { id: 'mindmap-chapter', tab: 'mindmap', mindmap: 'chapter', path: { group: 'mindmap', key: 'chapter' }, labelKey: 'promptEditor.entries.mindmapChapter', hintKey: 'promptEditor.hints.mindmapChapter', vars: CHAPTER_VARS },
  { id: 'mindmap-arrow', tab: 'mindmap', mindmap: 'arrow', path: { group: 'mindmap', key: 'arrow' }, labelKey: 'promptEditor.entries.mindmapArrow', hintKey: 'promptEditor.hints.mindmapArrow', vars: ['chapterSummaries'] },
  { id: 'mindmap-combined', tab: 'mindmap', mindmap: 'combined', path: { group: 'mindmap', key: 'combined' }, labelKey: 'promptEditor.entries.mindmapCombined', hintKey: 'promptEditor.hints.mindmapCombined', vars: ['bookTitle', 'chapterSummaries'] },
  { id: 'connection', tab: 'connectionAnalysis', path: { group: 'connectionAnalysis' }, labelKey: 'promptEditor.connectionAnalysisPrompt', hintKey: 'promptEditor.hints.connectionAnalysis', vars: ['chapterSummaries'] },
  { id: 'overall', tab: 'overallSummary', path: { group: 'overallSummary' }, labelKey: 'promptEditor.overallSummaryPrompt', hintKey: 'promptEditor.hints.overallSummary', vars: ['bookTitle', 'chapterInfo', 'connections'] },
]

const TABS: { value: PromptTab; labelKey: string }[] = [
  { value: 'chapterSummary', labelKey: 'promptEditor.chapterSummary' },
  { value: 'mindmap', labelKey: 'promptEditor.mindmap' },
  { value: 'connectionAnalysis', labelKey: 'promptEditor.connectionAnalysis' },
  { value: 'overallSummary', labelKey: 'promptEditor.overallSummary' },
]

function readPrompt(config: PromptConfig, path: PromptPath): string {
  switch (path.group) {
    case 'chapterSummary':
      return config.chapterSummary[path.key]
    case 'mindmap':
      return config.mindmap[path.key]
    case 'connectionAnalysis':
      return config.connectionAnalysis
    case 'overallSummary':
      return config.overallSummary
  }
}

function writePrompt(path: PromptPath, value: string): void {
  const s = usePromptStore.getState()
  switch (path.group) {
    case 'chapterSummary':
      s.setChapterSummaryPrompt(path.key === 'fiction' ? 'fiction' : 'non-fiction', value)
      break
    case 'mindmap':
      s.setMindmapPrompt(path.key, value)
      break
    case 'connectionAnalysis':
      s.setConnectionAnalysisPrompt(value)
      break
    case 'overallSummary':
      s.setOverallSummaryPrompt(value)
      break
  }
}

/** 按当前处理设置判断该条目是否会被用到（只做提示，不限制编辑） */
function isInUse(entry: PromptEntry, options: ProcessingOptions): boolean {
  const { path } = entry
  if (path.group === 'chapterSummary') return (options.bookType === 'fiction') === (path.key === 'fiction')
  if (path.group === 'mindmap') {
    if (options.processingMode === 'summary') return false
    if (path.key === 'combined') return options.processingMode === 'combined-mindmap'
    return true
  }
  return true
}

interface PromptEntryEditorProps {
  entry: PromptEntry
  value: string
  overridden: boolean
  inUse: boolean
  preview: string | null
}

function PromptEntryEditor({ entry, value, overridden, inUse, preview }: PromptEntryEditorProps) {
  const { t } = useTranslation()
  const resetPrompt = usePromptStore((s) => s.resetPrompt)
  const textareaId = `prompt-${entry.id}`
  const hintId = `${textareaId}-hint`
  const label = t(entry.labelKey)

  return (
    <section className="space-y-2 rounded-lg border p-3" aria-labelledby={`${textareaId}-label`}>
      <div className="flex flex-wrap items-center gap-2">
        <label id={`${textareaId}-label`} htmlFor={textareaId} className="text-sm font-medium">
          {label}
        </label>
        {inUse && (
          <Badge variant="outline" className="px-1.5 py-0 text-xs">
            {t('promptEditor.inUse')}
          </Badge>
        )}
        {overridden && (
          <Badge variant="secondary" className="px-1.5 py-0 text-xs">
            {t('promptEditor.customized')}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <CopyButton content={preview ?? value} variant="ghost" size="sm" title={t('promptEditor.copy')} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            disabled={!overridden}
            onClick={() => resetPrompt(entry.path)}
            aria-label={t('promptEditor.resetEntryFor', { name: label })}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            {t('promptEditor.resetEntry')}
          </Button>
        </div>
      </div>
      <p id={hintId} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <span>{t(entry.hintKey)}</span>
        <span>{t('promptEditor.placeholders')}:</span>
        {entry.vars.map((name) => (
          <code key={name} className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            {`{{${name}}}`}
          </code>
        ))}
      </p>
      <Textarea
        id={textareaId}
        value={preview ?? value}
        // 预览只读（沿用 disabled 语义）；覆盖 disabled 的半透明样式，保证可读
        disabled={preview !== null}
        onChange={(e) => writePrompt(entry.path, e.target.value)}
        placeholder={t('promptEditor.placeholder')}
        aria-describedby={hintId}
        spellCheck={false}
        className={`max-h-[45vh] min-h-[180px] overflow-y-auto font-mono text-xs leading-relaxed ${
          preview !== null ? 'bg-muted/60 disabled:cursor-text disabled:opacity-100' : ''
        }`}
      />
    </section>
  )
}

function ResetAllButton({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const resetAllPrompts = usePromptStore((s) => s.resetAllPrompts)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t('promptEditor.resetAll')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('promptEditor.resetAllTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('promptEditor.resetAllDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={resetAllPrompts}>{t('promptEditor.resetAll')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function PromptEditor() {
  const { t } = useTranslation()
  const promptConfig = usePromptStore((s) => s.promptConfig)
  const overrides = usePromptStore((s) => s.overrides)
  const processingOptions = useProcessingOptions()
  const [activeTab, setActiveTab] = useState<PromptTab>('chapterSummary')
  const [previewMode, setPreviewMode] = useState(false)

  const samples = {
    title: t('promptEditor.preview.title'),
    content: t('promptEditor.preview.content'),
    chapterSummaries: t('promptEditor.preview.chapterSummaries'),
    chapterInfo: t('promptEditor.preview.chapterInfo'),
    connections: t('promptEditor.preview.connections'),
    bookTitle: t('promptEditor.preview.bookTitle'),
  }

  const customizedCount = ENTRIES.filter((e) => isPromptOverridden(overrides, e.path)).length

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2">
          <Pencil className="h-4 w-4" />
          {t('promptEditor.title')}
        </CardTitle>
        <CardDescription>{t('promptEditor.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-start gap-2 rounded-md border bg-muted px-3 py-2 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span>{t('promptEditor.versionNote', { version: DEFAULT_PROMPT_VERSION })}</span>
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              {processingOptions.bookType === 'fiction' ? t('promptEditor.fiction') : t('promptEditor.nonFiction')}
            </Badge>
            <Badge variant="outline">
              {processingOptions.processingMode === 'summary'
                ? t('promptEditor.summary')
                : processingOptions.processingMode === 'mindmap'
                  ? t('promptEditor.mindmap')
                  : t('promptEditor.combinedMindmap')}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {customizedCount > 0
                ? t('promptEditor.customizedCount', { count: customizedCount })
                : t('promptEditor.allDefault')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={previewMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPreviewMode((v) => !v)}
              aria-pressed={previewMode}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              {previewMode ? t('promptEditor.editMode') : t('promptEditor.previewMode')}
            </Button>
            <ResetAllButton disabled={!hasPromptOverrides(overrides)} />
          </div>
        </div>

        {previewMode && <p className="text-xs text-muted-foreground">{t('promptEditor.previewNote')}</p>}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PromptTab)}>
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
            {TABS.map((tab) => {
              const dirty = ENTRIES.some((e) => e.tab === tab.value && isPromptOverridden(overrides, e.path))
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="whitespace-normal">
                  {t(tab.labelKey)}
                  {dirty && (
                    <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-label={t('promptEditor.customized')} />
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>

          {TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-3 space-y-3">
              {ENTRIES.filter((e) => e.tab === tab.value)
                // 当前处理设置会用到的条目排在前面
                .sort((x, y) => Number(isInUse(y, processingOptions)) - Number(isInUse(x, processingOptions)))
                .map((entry) => {
                const value = readPrompt(promptConfig, entry.path)
                return (
                  <PromptEntryEditor
                    key={entry.id}
                    entry={entry}
                    value={value}
                    overridden={isPromptOverridden(overrides, entry.path)}
                    inUse={isInUse(entry, processingOptions)}
                    preview={previewMode ? buildPromptPreview(entry.tab, value, samples, entry.mindmap ?? false) : null}
                  />
                )
              })}
            </TabsContent>
          ))}
        </Tabs>

        <p className="border-t pt-3 text-xs text-muted-foreground">{t('promptEditor.autoSaveNote')}</p>
      </CardContent>
    </Card>
  )
}
