import { useTranslation } from 'react-i18next'
import { AlertTriangle, CloudOff } from 'lucide-react'
import { useStudyStore } from '@/study/studyStore'
import type { StudyPart } from '@/study/persistence'

/**
 * 速读 / 自测的云端提示：只在需要用户知情时出现一行——
 * 内容是按旧总结生成的（可重新生成）、云端那份来自更新的版本（只读不动）、云端不可用（只存本机）。
 *
 * 按面板分开看：只重生成速读时，自测面板不该跟着显得「已经跟上当前总结」。
 */
export function SyncNote({ part }: { part: StudyPart }) {
  const { t } = useTranslation()
  const stale = useStudyStore((s) => s.staleParts[part])
  const sync = useStudyStore((s) => s.sync)

  if (sync === 'newer') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {t('study.sync.newer')}
      </p>
    )
  }
  if (stale) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {t('study.sync.stale')}
      </p>
    )
  }
  if (sync === 'offline') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
        <CloudOff className="mt-0.5 size-3.5 shrink-0" />
        {t('study.sync.offline')}
      </p>
    )
  }
  return null
}
