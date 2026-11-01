import type { TFunction } from 'i18next'
import type { GroupBy, RecommendReason } from '@/services/library/libraryOrganize'

/** 书的体积：书卡、悬浮卡、详情用同一个格式（≥1MB 一位小数，否则 KB） */
export const formatBookSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/**
 * 分类名（EPUB 的 dc:subject 英文词表）→ i18n 键。词表之外的分类原样显示。
 * 键写成字面量表（而不是拼接），这样重命名/删键时有测试兜底（tests/library/categoryLabels.test.ts）。
 */
export const CATEGORY_KEYS: Record<string, string> = {
  Business: 'library.categories.Business',
  History: 'library.categories.History',
  Economics: 'library.categories.Economics',
  China: 'library.categories.China',
  Politics: 'library.categories.Politics',
  Philosophy: 'library.categories.Philosophy',
  Biography: 'library.categories.Biography',
  Sociology: 'library.categories.Sociology',
  Classics: 'library.categories.Classics',
  International: 'library.categories.International',
  Psychology: 'library.categories.Psychology',
  'Self Help': 'library.categories.SelfHelp',
  Science: 'library.categories.Science',
  Literature: 'library.categories.Literature',
  Reference: 'library.categories.Reference',
  War: 'library.categories.War',
  Religion: 'library.categories.Religion',
  Art: 'library.categories.Art',
}

export function categoryLabel(t: TFunction, name: string): string {
  const key = CATEGORY_KEYS[name]
  return key ? t(key) : name
}

/** i18n 要求静态 key：分组键 → 文案（作者/目录名/出版社直接显示原文）。by 用来区分「未知」是未知作者还是未标注 */
export function groupLabel(t: TFunction, key: string, by?: GroupBy): string {
  if (key.startsWith('a:') || key.startsWith('d:') || key.startsWith('p:') || key.startsWith('y:')) return key.slice(2)
  if (key.startsWith('c:')) return categoryLabel(t, key.slice(2))
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
      return by === 'author' || by === undefined ? t('library.groupLabel.unknownAuthor') : t('library.groupLabel.unknown')
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
    case 'sameCategory':
      return t('library.recommend.reason.sameCategory')
    case 'fresh':
      return t('library.recommend.reason.fresh')
    case 'retry':
      return t('library.recommend.reason.retry')
    case 'revisit':
      return t('library.recommend.reason.revisit')
  }
}

export function unreachableLabel(t: TFunction, reason: 'off' | 'timeout' | 'scan-failed'): string {
  switch (reason) {
    case 'off':
      return t('library.unreachable.off')
    case 'timeout':
      return t('library.unreachable.timeout')
    case 'scan-failed':
      return t('library.unreachable.scanFailed')
  }
}
