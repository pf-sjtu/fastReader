import type { TFunction } from 'i18next'
import type { RecommendReason } from '@/services/library/libraryOrganize'

/** i18n 要求静态 key：分组键 → 文案（作者/目录名直接显示原文） */
export function groupLabel(t: TFunction, key: string): string {
  if (key.startsWith('a:') || key.startsWith('d:')) return key.slice(2)
  switch (key) {
    case 'all':
      return t('library.group.all')
    case 'reading':
      return t('library.groupLabel.reading')
    case 'partial':
      return t('library.groupLabel.partial')
    case 'unprocessed':
      return t('library.groupLabel.unprocessed')
    case 'done':
      return t('library.groupLabel.done')
    case 'unknown':
      return t('library.groupLabel.unknownAuthor')
    case 'root':
      return t('library.groupLabel.root')
    default:
      return key.toUpperCase()
  }
}

export function reasonLabel(t: TFunction, reason: RecommendReason): string {
  switch (reason) {
    case 'resume':
      return t('library.recommend.reason.resume')
    case 'sameAuthor':
      return t('library.recommend.reason.sameAuthor')
    case 'fresh':
      return t('library.recommend.reason.fresh')
    case 'retry':
      return t('library.recommend.reason.retry')
    case 'revisit':
      return t('library.recommend.reason.revisit')
  }
}
