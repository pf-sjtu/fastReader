import type { TFunction } from 'i18next'
import type { OpenProgress } from '@/stores/openProgress'
import { fractionOf } from '@/services/webdav/progress'
import { formatFileSize } from '@/utils/file'

/** 剩余时间：< 1 分钟只写秒；< 1 小时写「分 秒」；再长写「小时 分」。至少显示 1 秒，避免「剩余 0 秒」还没完的怪异感 */
export function formatEta(t: TFunction, seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  if (s < 60) return t('library.download.duration.s', { s })
  if (s < 3600) return t('library.download.duration.ms', { m: Math.floor(s / 60), s: s % 60 })
  return t('library.download.duration.hm', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
}

/** 一行状态文字：阶段 + 百分比 + 已下载/总量 + 速度 + 剩余时间；拿不到的部分直接省略，不显示「NaN」 */
export function openStatusText(t: TFunction, p: OpenProgress): string {
  if (p.phase === 'connecting') return t('library.download.connecting')
  if (p.phase === 'parsing') return t('library.download.parsing')
  const d = p.progress
  if (!d) return t('library.download.starting')
  const frac = fractionOf(d)
  const parts: string[] = []
  if (p.stalled) parts.push(t('library.download.stalled'))
  else if (frac != null) parts.push(t('library.download.percent', { pct: Math.floor(frac * 100) }))
  parts.push(d.total ? `${formatFileSize(d.loaded)} / ${formatFileSize(d.total)}` : t('library.download.loaded', { size: formatFileSize(d.loaded) }))
  if (!p.stalled && d.speed > 0) parts.push(`${formatFileSize(d.speed)}/s`)
  if (!p.stalled && d.etaSeconds != null && d.etaSeconds > 0) parts.push(t('library.download.eta', { time: formatEta(t, d.etaSeconds) }))
  return parts.join(' · ')
}
