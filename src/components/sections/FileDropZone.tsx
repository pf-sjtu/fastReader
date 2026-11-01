import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Network, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatBookSize } from '@/components/library/labels'

interface Props {
  file: File | null
  disabled: boolean
  onPickLocal: () => void
  onOpenWebDAV: () => void
  /** 拖进来的文件：与「本地上传」走同一条路径（格式校验在 onFileSelect 里） */
  onDropFile: (file: File) => void
  /** 其余入口（批量处理等），排在按钮行末尾 */
  children?: ReactNode
}

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toUpperCase() : '')

/**
 * 落笔区：一块宣纸似的大区域，既是拖拽目标，也是「当前这本书」的名牌。
 * 空态：大号印章图标 + 一句话邀请；有书时：书名用衬线大字、下面是格式与体积；拖入时整块变朱砂淡底并提示「松开即可载入」。
 * 拖拽用进入计数避免在子元素间移动时闪烁；处理中不接收拖入。
 */
export function FileDropZone({ file, disabled, onPickLocal, onOpenWebDAV, onDropFile, children }: Props) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const enter = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current += 1
    setDragging(true)
  }
  const over = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault() // 不阻止默认行为，浏览器不会把这里当作可放置目标
    e.dataTransfer.dropEffect = 'copy'
  }
  const leave = () => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    if (disabled) return
    const f = e.dataTransfer?.files?.[0]
    if (f) onDropFile(f)
  }

  const meta = file ? [extOf(file.name), file.size > 0 ? formatBookSize(file.size) : ''].filter(Boolean).join(' · ') : ''

  return (
    <div
      data-slot="file-drop-zone"
      data-dragging={dragging || undefined}
      onDragEnter={enter}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
      className={cn(
        'relative overflow-hidden rounded-lg border-2 border-dashed p-4 transition-colors sm:p-5',
        dragging ? 'border-primary bg-primary/10' : file ? 'border-primary/40 bg-primary/5' : 'bg-background/60 hover:border-primary/50'
      )}
    >
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <span
          className={cn(
            'grid size-14 shrink-0 place-items-center rounded-lg transition-colors',
            file || dragging ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
          )}
        >
          {file ? <FileText className="size-6" aria-hidden /> : <Upload className="size-6" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {file ? (
            <>
              <p className="t-title truncate" title={file.name}>
                {file.name}
              </p>
              <p className="t-caption tabular-nums">{meta}</p>
            </>
          ) : (
            <>
              <p className="t-title">
                <span className="sr-only">{t('upload.noFileSelected')}。</span>
                {t('upload.dropHere')}
              </p>
              <p className="t-caption">{t('upload.dropFormats')}</p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:shrink-0 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onPickLocal} disabled={disabled} className="flex items-center gap-2 min-h-9">
            <Upload className="size-4" />
            {t('upload.localUpload')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onOpenWebDAV} disabled={disabled} className="flex items-center gap-2 min-h-9">
            <Network className="size-4" />
            WebDAV
          </Button>
          {children}
        </div>
      </div>
      {dragging && (
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/10 backdrop-blur-[1px]">
          <span className="t-title rounded-full bg-primary px-4 py-1.5 text-primary-foreground shadow-md">{t('upload.dropRelease')}</span>
        </div>
      )}
    </div>
  )
}
