import { useMemo } from 'react'
import { isUsableText } from '@/utils/resultStatus'
import { stripRichBlocks } from '@/lib/richBlocks'
import type { BookCharts } from '../types'
import { buildEntityLinking, type EntityLinking, type LinkChapter } from './entityLinking'

interface SourceChapter {
  id: string
  title: string
  summary?: string
  meta?: LinkChapter['meta']
}

/**
 * 联动查询表的 memo 包装。
 * processing 期间章节在流式增长，每次都重算没有意义（也会让颜色随排序抖动），所以处理中返回 null。
 */
export function useEntityLinking(
  charts: BookCharts | null | undefined,
  chapters: readonly SourceChapter[],
  processing: boolean
): EntityLinking | null {
  return useMemo(() => {
    if (processing) return null
    const linkChapters: LinkChapter[] = chapters.map((c) => ({
      id: c.id,
      title: c.title,
      // 失败/跳过的章节带占位前缀，不参与匹配
      // 图示 / 组件 / 交互块不是正文：块里的名字既画不出高亮，也不该算「出现在这一章」
      text: isUsableText(c.summary) ? stripRichBlocks(c.summary as string) : '',
      meta: c.meta,
    }))
    return buildEntityLinking(charts, linkChapters)
  }, [charts, chapters, processing])
}
