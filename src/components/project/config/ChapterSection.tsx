// 章节相关设置：命名 / 通知 / 跳过无关章节 / 递归深度 / 并行数 / 章节识别模式
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConfigStore, useProcessingOptions } from '../../../stores/configStore'

type DetectionMode = 'normal' | 'smart' | 'epub-toc'

const DETECTION_MODES: { value: DetectionMode; id: string; labelKey: string; descKey: string }[] = [
  { value: 'normal', id: 'normal-mode', labelKey: 'config.normalMode', descKey: 'config.normalModeDescription' },
  { value: 'smart', id: 'smart-mode', labelKey: 'config.smartDetectionMode', descKey: 'config.smartDetectionModeDescription' },
  { value: 'epub-toc', id: 'epub-toc-mode', labelKey: 'config.epubTocMode', descKey: 'config.epubTocModeDescription' },
]
const RECURSION_KEYS = [
  'config.noRecursion',
  'config.recursion1Layer',
  'config.recursion2Layers',
  'config.recursion3Layers',
  'config.recursion4Layers',
  'config.recursion5Layers',
]
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10]
const TOC_DEPTHS = [1, 2, 3, 4, 5]

export function ChapterSection({ processing }: { processing: boolean }) {
  const { t } = useTranslation()
  const opts = useProcessingOptions()
  const s = useConfigStore.getState
  const chapterConcurrency = opts.chapterConcurrency ?? 3
  const epubTocDepth = opts.epubTocDepth || 1

  return (
    <>
      <div className="space-y-4 p-4 bg-green-50 dark:bg-green-950/50 rounded-lg border dark:border-green-800">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="h-4 w-4" />
          <Label className="text-sm font-medium">{t('config.chapterAndNotificationSettings')}</Label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2 min-w-0 w-full">
            <Label htmlFor="chapter-naming-mode" className="text-wrap text-sm font-medium">
              {t('config.chapterNamingMode')}
            </Label>
            <Select
              value={opts.chapterNamingMode || 'auto'}
              onValueChange={(v: 'auto' | 'numbered') => s().setChapterNamingMode(v)}
              disabled={processing}
            >
              <SelectTrigger className="w-full" id="chapter-naming-mode">
                <SelectValue placeholder={t('config.selectChapterNamingMode')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('config.autoNaming')}</SelectItem>
                <SelectItem value="numbered">{t('config.numberedNaming')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t('config.chapterNamingModeDescription')}</p>
          </div>

          <div className="space-y-2 min-w-0 w-full">
            <Label className="text-wrap text-sm font-medium">{t('config.notificationSettings')}</Label>
            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="enable-notification"
                checked={opts.enableNotification}
                onCheckedChange={(v) => s().setEnableNotification(v)}
                disabled={processing}
              />
              <Label htmlFor="enable-notification" className="text-sm">
                {t('config.enableNotification')}
              </Label>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t('config.notificationDescription')}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/50 rounded-lg border dark:border-green-800">
        <div className="space-y-1">
          <Label htmlFor="skip-non-essential" className="text-sm font-medium">
            {t('config.skipIrrelevantChapters')}
          </Label>
          <p className="text-xs text-gray-600">{t('config.skipIrrelevantChaptersDescription')}</p>
        </div>
        <Switch
          id="skip-non-essential"
          checked={opts.skipNonEssentialChapters}
          onCheckedChange={(v) => s().setSkipNonEssentialChapters(v)}
          disabled={processing}
        />
      </div>

      <div className="p-3 bg-amber-50 dark:bg-amber-950/50 rounded-lg border dark:border-amber-800">
        <div className="space-y-2">
          <Label htmlFor="max-sub-chapter-depth" className="text-sm font-medium">
            {t('config.recursionDepth')}
          </Label>
          <Select
            value={opts.maxSubChapterDepth?.toString()}
            onValueChange={(v) => s().setMaxSubChapterDepth(parseInt(v, 10))}
            disabled={processing}
          >
            <SelectTrigger id="max-sub-chapter-depth">
              <SelectValue placeholder={t('config.selectRecursionDepth')} />
            </SelectTrigger>
            <SelectContent>
              {RECURSION_KEYS.map((key, depth) => (
                <SelectItem key={key} value={String(depth)}>
                  {t(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-600">{t('config.recursionDepthDescription')}</p>
        </div>
      </div>

      <div className="p-3 bg-sky-50 dark:bg-sky-950/50 rounded-lg border dark:border-sky-800">
        <div className="space-y-2">
          <Label htmlFor="chapter-concurrency" className="text-sm font-medium">
            {t('config.chapterConcurrency')}
          </Label>
          <Select
            value={String(chapterConcurrency)}
            onValueChange={(v) => s().setChapterConcurrency(parseInt(v, 10))}
            disabled={processing}
          >
            <SelectTrigger id="chapter-concurrency">
              <SelectValue placeholder={t('config.selectChapterConcurrency')} />
            </SelectTrigger>
            <SelectContent>
              {CONCURRENCY_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t('config.chapterConcurrencyValue', { count: n })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t('config.chapterConcurrencyDescription')}</p>
        </div>
      </div>

      <div className="space-y-4 p-4 bg-muted rounded-lg border">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="h-4 w-4" />
          <Label className="text-sm font-medium">{t('config.chapterDetectionMode')}</Label>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t('config.selectDetectionMode')}</Label>
            <div className="space-y-2">
              {DETECTION_MODES.map((m) => (
                <div key={m.value}>
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id={m.id}
                      name="chapter-detection-mode"
                      value={m.value}
                      checked={opts.chapterDetectionMode === m.value}
                      onChange={() => s().setChapterDetectionMode(m.value)}
                      disabled={processing}
                    />
                    <Label htmlFor={m.id} className="text-sm font-normal">
                      {t(m.labelKey)}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 ml-6">{t(m.descKey)}</p>
                </div>
              ))}
            </div>
          </div>

          {opts.chapterDetectionMode === 'epub-toc' && (
            <div className="space-y-2">
              <Label htmlFor="epub-toc-depth" className="text-sm font-medium">
                {t('config.epubTocDepth')}
              </Label>
              <Select
                value={String(epubTocDepth)}
                onValueChange={(v) => s().setEpubTocDepth(parseInt(v, 10))}
                disabled={processing}
              >
                <SelectTrigger id="epub-toc-depth">
                  <SelectValue placeholder={t('config.selectEpubTocDepth')} />
                </SelectTrigger>
                <SelectContent>
                  {TOC_DEPTHS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {t(`config.epubTocDepth${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('config.epubTocDepthDescription')}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
