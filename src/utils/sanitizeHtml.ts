import DOMPurify from 'dompurify'

// 书籍 HTML（EPUB 章节、用户上传/WebDAV 来源）一律视为不可信：
// Shadow DOM 只隔离样式不隔离脚本，onerror 等事件属性可在同源执行并读取 localStorage 中的凭据
const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link']
// DOMPurify 默认 URI 白名单 + blob:（epubjs 会把章节内图片替换为 blob URL，默认规则会把它们删掉）
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

export function sanitizeBookHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    FORBID_TAGS,
    // DOMPurify 默认移除所有 on* 事件属性与 javascript: URL
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP,
  })
}
