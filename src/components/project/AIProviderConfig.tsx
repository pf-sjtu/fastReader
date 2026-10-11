// AI 服务商列表：激活 / 编辑 / 复制 / 删除；编辑表单见 config/AIProviderDialog
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Copy, Trash2, Edit, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useConfigStore } from '../../stores/configStore'
import type { AIProviderConfig as ProviderConfig } from '../../stores/types'
import { AIProviderDialog } from './config/AIProviderDialog'
import { ProviderIcon } from './config/ProviderIcon'
import { getDisplayName } from './config/providerUtils'

const PROVIDER_COLORS: Record<string, string> = {
  gemini: 'bg-secondary text-secondary-foreground',
  openai: 'bg-green-100 text-green-800',
  ollama: 'bg-purple-100 text-purple-800',
  '302.ai': 'bg-orange-100 text-orange-800',
}

interface AIProviderListItemProps {
  index: number // 1-based
  provider: ProviderConfig
  isActive: boolean
  onActivate: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function AIProviderListItem({ index, provider, isActive, onActivate, onEdit, onDuplicate, onDelete }: AIProviderListItemProps) {
  const { t } = useTranslation()
  const name = getDisplayName(provider.apiUrl, provider.model)
  const iconButtons = [
    { label: t('common.edit'), onClick: onEdit, Icon: Edit },
    { label: t('common.copy'), onClick: onDuplicate, Icon: Copy },
    { label: t('common.delete'), onClick: onDelete, Icon: Trash2 },
  ]

  return (
    <div
      className={`grid w-full items-start gap-3 p-3 border rounded-lg transition-colors sm:grid-cols-[minmax(0,1fr)_auto] ${
        isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <ProviderIcon provider={provider.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium truncate">
              #{index} {name}
            </span>
            <Badge className={`${PROVIDER_COLORS[provider.provider] ?? 'bg-gray-100 text-gray-800'} text-xs px-1.5 py-0.5 flex-shrink-0`}>
              {provider.provider}
            </Badge>
            {isActive && (
              <Badge variant="default" className="text-xs px-1.5 py-0.5 flex-shrink-0 bg-primary">
                {t('aiProvider.current')}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="truncate">{t('aiProvider.modelValue', { model: provider.model })}</span>
            <span className="flex-shrink-0">{t('aiProvider.temperatureValue', { value: provider.temperature })}</span>
            {provider.proxyEnabled && <span className="flex-shrink-0 text-primary">{t('aiProvider.proxyBadge')}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end w-full sm:w-auto">
        <Button size="sm" variant={isActive ? 'default' : 'outline'} onClick={onActivate} className="h-8 px-3 text-xs">
          {isActive ? t('aiProvider.inUse') : t('aiProvider.use')}
        </Button>
        {iconButtons.map(({ label, onClick, Icon }) => (
          <Button
            key={label}
            size="sm"
            variant="ghost"
            onClick={onClick}
            className="h-8 w-8 p-0"
            aria-label={`${label} ${name}`}
            title={label}
          >
            <Icon className="h-3 w-3" />
          </Button>
        ))}
      </div>
    </div>
  )
}

export function AIProviderConfig() {
  const { t } = useTranslation()
  const { aiConfigManager, setCurrentModelId, addAIProvider, updateAIProvider, deleteAIProvider, duplicateAIProvider } =
    useConfigStore(
      useShallow((s) => ({
        aiConfigManager: s.aiConfigManager,
        setCurrentModelId: s.setCurrentModelId,
        addAIProvider: s.addAIProvider,
        updateAIProvider: s.updateAIProvider,
        deleteAIProvider: s.deleteAIProvider,
        duplicateAIProvider: s.duplicateAIProvider,
      }))
    )

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ provider: ProviderConfig; index: number } | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  // 当前激活的配置不存在时重置为第一个
  useEffect(() => {
    const count = aiConfigManager.providers.length
    const currentIndex = aiConfigManager.currentModelId - 1
    if (count > 0 && (currentIndex < 0 || currentIndex >= count)) setCurrentModelId(1)
  }, [aiConfigManager.providers, aiConfigManager.currentModelId, setCurrentModelId])

  const handleDelete = (index: number, provider: ProviderConfig) => {
    if (aiConfigManager.providers.length <= 1) {
      toast.error(t('aiProvider.keepAtLeastOne'))
      return
    }
    if (confirm(t('aiProvider.confirmDelete', { name: getDisplayName(provider.apiUrl, provider.model) }))) {
      deleteAIProvider(index)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-muted border">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="text-sm text-foreground">
              <p className="font-medium mb-1">{t('aiProvider.introTitle')}</p>
              <p className="text-xs">{t('aiProvider.intro')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">{t('aiProvider.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('aiProvider.subtitle')}</p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProvider.add')}
        </Button>
      </div>

      <div className="space-y-2">
        {aiConfigManager.providers.map((provider, i) => {
          const index = i + 1
          return (
            <AIProviderListItem
              key={index}
              index={index}
              provider={provider}
              isActive={index === aiConfigManager.currentModelId}
              onActivate={() => setCurrentModelId(index)}
              onEdit={() => {
                setEditing({ provider, index })
                setIsEditDialogOpen(true)
              }}
              onDuplicate={() => duplicateAIProvider(index)}
              onDelete={() => handleDelete(index, provider)}
            />
          )
        })}
      </div>

      <AIProviderDialog mode="create" open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} onSave={(p) => void addAIProvider(p)} />

      {editing && (
        <AIProviderDialog
          mode="edit"
          provider={editing.provider}
          index={editing.index}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSave={(p, index) => updateAIProvider(index ?? editing.index, p)}
        />
      )}
    </div>
  )
}
