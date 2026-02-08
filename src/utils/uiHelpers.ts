import { toast } from 'sonner'
import type { MindElixirData, MindElixirInstance } from 'mind-elixir'

/**
 * 滚动到页面顶部
 */
export const scrollToTop = () => {
  const scrollContainer = document.querySelector('.scroll-container')
  if (scrollContainer) {
    scrollContainer.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }
}

/**
 * 在 MindElixir Desktop 中打开思维导图（已禁用）
 * @param _mindmapData 思维导图数据
 * @param _title 思维导图标题
 */
export const openInMindElixir = async (...args: [MindElixirData, string]) => {
  void args
  toast.error('此功能已被禁用', {
    duration: 3000,
    position: 'top-center',
  })
}

/**
 * 下载思维导图（已禁用）
 * @param _mindElixirInstance MindElixir 实例
 * @param _title 思维导图标题
 * @param _format 导出格式
 */
export const downloadMindMap = async (...args: [MindElixirInstance, string, string]) => {
  void args
  toast.error('此功能已被禁用', {
    duration: 3000,
    position: 'top-center',
  })
}
