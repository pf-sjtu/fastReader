/**
 * 章节标题：提取阶段可硬丢弃的关键词（skipNonEssentialChapters）
 * 与「默认不勾选」词表共享主体；序言/后记不在「默认不勾选」中。
 */
export const SKIP_CHAPTER_KEYWORDS = [
  // 英文
  'acknowledgments', 'ack', 'acknowledgement', 'thanks', 'gratitude',
  'recommended reading', 'further reading', 'bibliography', 'references',
  'about the author', 'about author', 'author bio', 'biography',
  'praise for', 'reviews', 'testimonials', 'endorsements',
  'title page', 'copyright', 'dedication', 'contents', 'table of contents',
  'index', 'glossary', 'appendix', 'appendices',
  'notes', 'endnotes', 'footnotes',
  'illustration credits', 'image credits', 'other titles', 'epigraph',
  'about the book', 'also by', 'about the cover illustration',
  'colophon', 'cast of characters', 'list of characters',
  // 提取硬丢时可含；默认不勾选词表会再过滤掉序言/后记语义
  'preface', 'afterword', 'foreword',
  // 中文
  '作者简介', '译者简介', '作者／译者', '作者/译者', '关于作者', '关于译者',
  '人物表', '登场人物', '角色表',
  '致谢', '感谢',
  '图片来源', '插图来源', '图片说明',
  '版权', '版权页',
  '封面', '书名页', '目录',
  '献词', '献辞',
  '索引', '附录', '参考文献', '参考书目', '推荐阅读',
  '出版信息', '版本记录',
]

/**
 * 默认不勾选（选章 UI）：SKIP 中去掉序言/后记类，避免误伤正文导入与收束。
 */
export const DEFAULT_UNSELECT_CHAPTER_KEYWORDS = SKIP_CHAPTER_KEYWORDS.filter(
  (k) =>
    !['preface', 'afterword', 'foreword', '序言', '前言', '后记'].includes(
      k.toLowerCase()
    )
)

/** 提取硬丢弃：在默认不勾选基础上，可额外丢弃封面类（已含） */
export function matchesSkipChapterTitle(title: string): boolean {
  return matchesKeywords(title, SKIP_CHAPTER_KEYWORDS)
}

/** 选章默认不勾选 */
export function matchesDefaultUnselectTitle(title: string): boolean {
  return matchesKeywords(title, DEFAULT_UNSELECT_CHAPTER_KEYWORDS)
}

function matchesKeywords(title: string, keywords: string[]): boolean {
  if (!title) return false
  const lower = title.toLowerCase()
  return keywords.some((keyword) => {
    const k = keyword.toLowerCase()
    return lower.includes(k) || title.includes(keyword)
  })
}
