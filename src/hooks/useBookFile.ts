/**
 * 选书、章节提取、云缓存检查（均带代际保护：换书后旧任务结果丢弃）
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ChapterData } from '@/services/epubProcessor'
import { cloudCacheService, type ProcessingMetadata } from '@/services/cloudCacheService'
import { webdavService } from '@/services/webdavService'
import { matchesDefaultUnselectTitle } from '@/services/constants'
import { useConfigStore } from '@/stores/configStore'
import { detectBookFormat } from '@/utils/file'
import { isPartialCache } from '@/utils/chapterResults'
import type { GenerationCounter } from '@/utils/runGuard'
import { logger } from '@/lib/logger'
import { fileFingerprint, canHash } from '@/services/pipeline/cacheKeys'
import {
  createProcessor,
  extractionArgs,
  releaseBookResources,
  type AnyBookData,
  type BookProcessor,
} from '@/services/pipeline/extract'

export interface CloudCacheState {
  metadata: ProcessingMetadata | null
  content: string | null
  isPartial: boolean
  statusUnknown: boolean
  chartsJson: string | null
  chartsFileFound: boolean
}

const EMPTY_CLOUD: CloudCacheState = {
  metadata: null,
  content: null,
  isPartial: false,
  statusUnknown: false,
  chartsJson: null,
  chartsFileFound: false,
}

/** 默认勾选正文类；忽略类关键词（作者简介/致谢/版权等）默认不勾选，全被忽略时全选 */
export function defaultSelection(chapters: ReadonlyArray<{ id: string; title: string }>): Set<string> {
  const picked = chapters.filter((ch) => !matchesDefaultUnselectTitle(ch.title)).map((ch) => ch.id)
  return new Set(picked.length > 0 ? picked : chapters.map((ch) => ch.id))
}

export function useBookFile(generationRef: MutableRefObject<GenerationCounter>) {
  const { t } = useTranslation()
  const processingOptions = useConfigStore((s) => s.processingOptions)
  const webdavEnabled = useConfigStore((s) => s.webdavConfig.enabled)

  const [file, setFile] = useState<File | null>(null)
  const [extractingChapters, setExtractingChapters] = useState(false)
  const [extractedChapters, setExtractedChapters] = useState<ChapterData[] | null>(null)
  const [bookData, setBookData] = useState<{ title: string; author: string } | null>(null)
  const [fullBookData, setFullBookData] = useState<AnyBookData | null>(null)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [cloud, setCloud] = useState<CloudCacheState>(EMPTY_CLOUD)
  const [isCheckingCloudCache, setIsCheckingCloudCache] = useState(false)

  const processorRef = useRef<BookProcessor | null>(null)
  const fullBookDataRef = useRef<AnyBookData | null>(null)
  /** 云端存档文件名键（历史加载时可能没有本地 File） */
  const cloudCacheKeyRef = useRef<string | null>(null)
  const bookIdRef = useRef<{ file: File; id: Promise<string | null> } | null>(null)

  /** 当前书的本地缓存 id（文件指纹）；无文件或不可哈希时为 null */
  const getBookId = useCallback(
    (target: File | null = file): Promise<string | null> => {
      if (!target || !canHash()) return Promise.resolve(null)
      if (bookIdRef.current?.file !== target) {
        bookIdRef.current = {
          file: target,
          id: fileFingerprint(target).catch((e) => {
            logger.warn('[useBookFile] 计算文件指纹失败:', e)
            return null
          }),
        }
      }
      return bookIdRef.current.id
    },
    [file]
  )

  /** 释放旧书资源并清空状态（调用方负责递增代数） */
  const resetFile = useCallback(() => {
    releaseBookResources(processorRef.current, fullBookDataRef.current)
    processorRef.current = null
    fullBookDataRef.current = null
    bookIdRef.current = null
    setExtractingChapters(false)
    setIsCheckingCloudCache(false)
    setExtractedChapters(null)
    setBookData(null)
    setFullBookData(null)
    setSelectedChapters(new Set())
    setCloud(EMPTY_CLOUD)
  }, [])

  const extractChapters = useCallback(
    async (overrideFile?: File) => {
      const targetFile = overrideFile || file
      if (!targetFile) return
      const generation = generationRef.current.current
      const isStale = () => !generationRef.current.isCurrent(generation)
      let processor: BookProcessor | null = null

      setExtractingChapters(true)
      try {
        const format = detectBookFormat(targetFile)
        if (!format) {
          throw new Error(
            t('upload.unsupportedFormat', {
              defaultValue: `不支持的文件格式: ${targetFile.name}（仅支持 .epub / .pdf）`,
            })
          )
        }
        processor = await createProcessor(format)
        const result: AnyBookData & { chapters: ChapterData[] } = await processor.extractBookData(
          targetFile,
          ...extractionArgs(processingOptions)
        )
        if (isStale()) {
          releaseBookResources(processor, result)
          return
        }
        // 同一本书重新提取：释放上一次的解析资源
        if (processorRef.current && processorRef.current !== processor) {
          releaseBookResources(processorRef.current, fullBookDataRef.current)
        }
        processorRef.current = processor
        fullBookDataRef.current = result

        setFullBookData(result)
        setExtractedChapters(result.chapters)
        setBookData({ title: result.title, author: result.author })
        setSelectedChapters(defaultSelection(result.chapters))
        void getBookId(targetFile)
        toast.success(t('upload.chaptersExtracted', { count: result.chapters.length }))
      } catch (error) {
        if (isStale()) {
          releaseBookResources(processor, null)
          return
        }
        logger.error('提取章节错误:', error)
        toast.error(error instanceof Error ? error.message : t('upload.extractError'))
      } finally {
        if (!isStale()) setExtractingChapters(false)
      }
    },
    [file, processingOptions, t, generationRef, getBookId]
  )

  // 检查云端缓存（MD + 同名 JSON）；三态，unknown 不当作「无缓存」
  const checkCloudCache = useCallback(
    async (fileName: string): Promise<boolean> => {
      const generation = generationRef.current.current
      const isStale = () => !generationRef.current.isCurrent(generation)
      setCloud(EMPTY_CLOUD)
      cloudCacheKeyRef.current = fileName
      if (!webdavEnabled || !webdavService.isInitialized()) return false

      const markUnknown = () => {
        setCloud({ ...EMPTY_CLOUD, statusUnknown: true })
        toast.warning(t('cloudCache.statusUnknown'))
      }
      setIsCheckingCloudCache(true)
      try {
        const status = await cloudCacheService.checkCacheStatus(fileName)
        if (isStale() || status === 'missing') return false
        if (status === 'unknown') {
          markUnknown()
          return false
        }
        const result = await cloudCacheService.readCache(fileName)
        if (isStale()) return false
        if (result.success && result.content) {
          const parsed = cloudCacheService.parseUnifiedContent(result.content)
          setCloud({
            metadata: result.metadata || null,
            content: result.content,
            isPartial: isPartialCache({ ...parsed, metadata: result.metadata }),
            statusUnknown: false,
            chartsJson: result.chartsJson ?? null,
            chartsFileFound: !!result.chartsFileFound,
          })
          return true
        }
        // 文件存在却读不到：同样无法确认
        markUnknown()
        return false
      } catch (error) {
        if (!isStale()) logger.error('[useBookFile] 检查云端缓存失败:', error)
        return false
      } finally {
        if (!isStale()) setIsCheckingCloudCache(false)
      }
    },
    [webdavEnabled, t, generationRef]
  )

  const handleChapterSelect = useCallback((chapterId: string, checked: boolean) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev)
      if (checked) next.add(chapterId)
      else next.delete(chapterId)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (!extractedChapters) return
      setSelectedChapters(checked ? new Set(extractedChapters.map((ch) => ch.id)) : new Set())
    },
    [extractedChapters]
  )

  return {
    file,
    setFile,
    extractingChapters,
    extractedChapters,
    bookData,
    fullBookData,
    selectedChapters,
    setSelectedChapters,
    cloud,
    setCloud,
    isCheckingCloudCache,
    cloudCacheKeyRef,
    getBookId,
    resetFile,
    extractChapters,
    checkCloudCache,
    handleChapterSelect,
    handleSelectAll,
  }
}
