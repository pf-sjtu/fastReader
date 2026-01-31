import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EpubProcessor, type ChapterData, type BookData as EpubBookData } from '@/services/epubProcessor'
import { PdfProcessor, type BookData as PdfBookData } from '@/services/pdfProcessor'
import { AIService } from '@/services/aiService'
import { CacheService } from '@/services/cacheService'
import { notificationService } from '@/services/notificationService'
import type { MindElixirData } from 'mind-elixir'
import { useConfigStore } from '@/stores/configStore'

const epubProcessor = new EpubProcessor()
const pdfProcessor = new PdfProcessor()
const cacheService = new CacheService()

interface Chapter {
  id: string
  title: string
  content: string
  summary?: string
  mindMap?: MindElixirData
  processed: boolean
}

interface BookSummary {
  title: string
  author: string
  chapters: Chapter[]
  connections: string
  overallSummary: string
}

interface BookMindMap {
  title: string
  author: string
  chapters: Chapter[]
  combinedMindMap?: MindElixirData | null
}

export function useBookProcessing() {
  const { t } = useTranslation()
  const { tokenUsage, addTokenUsage, resetTokenUsage } = useConfigStore()
  
  const [processing, setProcessing] = useState(false)
  const [extractingChapters, setExtractingChapters] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [currentProcessingChapter, setCurrentProcessingChapter] = useState('')
  const abortControllerRef = useRef<AbortController | null>(null)

  const extractChapters = useCallback(async (
    file: File,
    options: {
      useSmartDetection: boolean
      skipNonEssentialChapters: boolean
      maxSubChapterDepth: number
      chapterNamingMode: 'auto' | 'numbered'
      chapterDetectionMode: 'normal' | 'smart' | 'epub-toc'
      epubTocDepth: number
    }
  ) => {
    if (!file) return null
    
    setExtractingChapters(true)
    try {
      let chapters: ChapterData[]
      
      if (file.name.endsWith('.epub')) {
        const bookData = await epubProcessor.parseEpub(file)
        const result = await epubProcessor.extractChapters(
          bookData.book,
          options.useSmartDetection,
          options.skipNonEssentialChapters,
          options.maxSubChapterDepth,
          options.chapterNamingMode,
          options.chapterDetectionMode,
          options.epubTocDepth
        )
        chapters = result
      } else if (file.name.endsWith('.pdf')) {
        chapters = await pdfProcessor.extractChapters(
          file,
          options.useSmartDetection,
          options.skipNonEssentialChapters,
          options.maxSubChapterDepth,
          options.chapterNamingMode,
          options.chapterDetectionMode
        )
      } else {
        throw new Error('不支持的文件格式')
      }
      
      return chapters
    } catch (error) {
      console.error('提取章节失败:', error)
      throw error
    } finally {
      setExtractingChapters(false)
    }
  }, [])

  const cancelProcessing = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setProcessing(false)
    setCurrentStep(t('progress.cancelled'))
  }, [t])

  return {
    processing,
    extractingChapters,
    progress,
    currentStep,
    currentProcessingChapter,
    tokenUsage,
    extractChapters,
    cancelProcessing,
    setProcessing,
    setProgress,
    setCurrentStep,
    setCurrentProcessingChapter,
    resetTokenUsage,
    addTokenUsage
  }
}
