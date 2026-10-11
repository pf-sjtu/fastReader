import React from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import type { MindElixirReactRef } from './project/MindElixirReact'
import type { MindElixirInstance } from 'mind-elixir'

interface DownloadMindMapButtonProps {
  mindElixirRef: React.RefObject<MindElixirReactRef | null> | (() => MindElixirReactRef | null | undefined)
  title: string
  downloadMindMap: (instance: MindElixirInstance, title: string, format: string) => void
}



export const DownloadMindMapButton: React.FC<DownloadMindMapButtonProps> = ({
  mindElixirRef,
  title,
  downloadMindMap,
}) => {
  const { t } = useTranslation()
  
  const EXPORT_FORMATS = [
    { key: 'PNG', label: t('download.formats.png') },
    { key: 'JPEG', label: t('download.formats.jpeg') },
    { key: 'WEBP', label: t('download.formats.webp') },
    { key: 'HTML', label: t('download.formats.html') },
    { key: 'JSON', label: t('download.formats.json') },
    { key: 'Markdown', label: t('download.formats.markdown') },
  ]
  const handleDownload = (format: string) => {
    let instance
    if (typeof mindElixirRef === 'function') {
      instance = mindElixirRef()?.instance
    } else {
      instance = mindElixirRef.current?.instance
    }
    
    if (instance) {
      downloadMindMap(instance, title, format)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={t('download.title')}
        >
          <Download className="h-4 w-4 mr-1" />
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem
            key={format.key}
            onClick={() => handleDownload(format.key)}
          >
            {format.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}