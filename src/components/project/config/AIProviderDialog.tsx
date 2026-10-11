// AI 服务商创建/编辑对话框（表单草稿，点保存才写入 store；有未保存改动时关闭需确认）
import { useEffect, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Play, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useConfigStore } from '../../../stores/configStore'
import type { AIProviderConfig } from '../../../stores/types'
import { useAIConnectionTest } from './useAIConnectionTest'
import { ProviderIcon } from './ProviderIcon'
import { EMPTY_PROVIDER_FORM, getDisplayName, isDuplicateProvider, toProviderConfig } from './providerUtils'

const INPUT_CLS = 'w-full h-8 px-2 text-sm border rounded-md box-border bg-background text-foreground border-border'

export interface AIProviderDialogProps {
  trigger?: ReactNode
  provider?: AIProviderConfig
  index?: number // 1-based
  mode: 'create' | 'edit'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (provider: AIProviderConfig, index?: number) => void
}

export function AIProviderDialog({ trigger, provider, index, mode, open, onOpenChange, onSave }: AIProviderDialogProps) {
  const { t } = useTranslation()
  const { getAvailableAITemplates, aiConfigManager } = useConfigStore(
    useShallow((s) => ({ getAvailableAITemplates: s.getAvailableAITemplates, aiConfigManager: s.aiConfigManager }))
  )
  const [formData, setFormData] = useState<Partial<AIProviderConfig>>(EMPTY_PROVIDER_FORM)
  // 打开时的表单快照：用于判断是否有未保存改动
  const [initialData, setInitialData] = useState<Partial<AIProviderConfig>>(EMPTY_PROVIDER_FORM)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [duplicateError, setDuplicateError] = useState(false)
  const { isTesting, result: testResult, test, reset: resetTest } = useAIConnectionTest()

  const templates = getAvailableAITemplates()
  const update = (patch: Partial<AIProviderConfig>) => setFormData((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    if (mode === 'edit' && provider) {
      setFormData(provider)
      setInitialData(provider)
      setDuplicateError(false)
    } else if (mode === 'create') {
      setFormData(EMPTY_PROVIDER_FORM)
      setInitialData(EMPTY_PROVIDER_FORM)
      setSelectedTemplate('')
      resetTest()
      setDuplicateError(false)
    }
  }, [mode, provider, open, resetTest])

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find((tpl) => tpl.id === templateId)
    if (!template) return
    setSelectedTemplate(templateId)
    // 模板只有名称：按显示名匹配已有配置，取其地址/模型/温度
    const matched = aiConfigManager.providers.find((p) =>
      getDisplayName(p.apiUrl, p.model).includes(template.name.split(' ')[0])
    )
    if (matched) {
      update({
        provider: templateId as AIProviderConfig['provider'],
        apiUrl: matched.apiUrl,
        model: matched.model,
        temperature: matched.temperature,
      })
    }
  }

  const isComplete = !!(formData.apiKey && formData.apiUrl && formData.model)

  const handleTest = async () => {
    if (!isComplete) {
      toast.error(t('aiProvider.fillAllFields'))
      return
    }
    const r = await test(toProviderConfig(formData))
    if (r.success) toast.success(r.message)
    else toast.error(r.message)
  }

  const handleSave = () => {
    if (!isComplete) {
      toast.error(t('aiProvider.fillAllFields'))
      return
    }
    if (isDuplicateProvider(aiConfigManager.providers, formData.apiUrl!, formData.model!, mode === 'edit' ? provider : undefined)) {
      setDuplicateError(true)
      toast.error(t('aiProvider.duplicateToast'))
      return
    }
    onSave(toProviderConfig(formData), index)
    onOpenChange(false)
    toast.success(mode === 'create' ? t('aiProvider.created') : t('aiProvider.updated'))
  }

  // 有未保存改动时关闭（Esc / 点遮罩 / 取消）需二次确认
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialData)
  const requestClose = () => {
    if (isDirty) setConfirmDiscardOpen(true)
    else onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ProviderIcon provider={formData.provider || 'gemini'} />
              {mode === 'create' ? t('aiProvider.createTitle') : t('aiProvider.editTitle')}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create' ? t('aiProvider.createDescription') : t('aiProvider.editDescription')}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="space-y-4 p-2 max-w-full">
              {mode === 'create' && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t('aiProvider.selectTemplate')}</CardTitle>
                    <CardDescription className="text-xs">{t('aiProvider.selectTemplateDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {templates.map((template) => (
                        <Button
                          key={template.id}
                          variant={selectedTemplate === template.id ? 'default' : 'outline'}
                          className="h-auto p-3 flex flex-col items-start justify-start text-left"
                          onClick={() => handleTemplateSelect(template.id)}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <ProviderIcon provider={template.id} />
                            <span className="font-medium text-sm">{template.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.description}</span>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t('aiProvider.basicInfo')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <label htmlFor="provider-type" className="text-xs font-medium">{t('aiProvider.providerType')}</label>
                      <select
                        id="provider-type"
                        value={formData.provider}
                        onChange={(e) => update({ provider: e.target.value as AIProviderConfig['provider'] })}
                        className={INPUT_CLS}
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI GPT</option>
                        <option value="ollama">Ollama Local</option>
                        <option value="302.ai">302.AI</option>
                        <option value="custom">{t('aiProvider.custom')}</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="provider-api-key" className="text-xs font-medium">{t('aiProvider.apiKey')}</label>
                      <input
                        id="provider-api-key"
                        type="password"
                        value={formData.apiKey || ''}
                        onChange={(e) => update({ apiKey: e.target.value })}
                        placeholder={t('aiProvider.apiKeyPlaceholder')}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label htmlFor="provider-api-url" className="text-xs font-medium">{t('aiProvider.apiUrl')}</label>
                      <input
                        id="provider-api-url"
                        type="text"
                        value={formData.apiUrl || ''}
                        onChange={(e) => {
                          update({ apiUrl: e.target.value })
                          setDuplicateError(false)
                        }}
                        placeholder={t('aiProvider.apiUrlPlaceholder')}
                        className={INPUT_CLS}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t('aiProvider.modelSettings')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <label htmlFor="provider-model" className="text-xs font-medium">{t('aiProvider.model')}</label>
                      <input
                        id="provider-model"
                        type="text"
                        value={formData.model || ''}
                        onChange={(e) => {
                          update({ model: e.target.value })
                          setDuplicateError(false)
                        }}
                        placeholder={t('aiProvider.modelPlaceholder')}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div>
                      <label htmlFor="provider-temperature" className="text-xs font-medium">{t('aiProvider.temperature')}</label>
                      <input
                        id="provider-temperature"
                        type="number"
                        min="0"
                        max="1"
                        step="0.1"
                        value={formData.temperature || 0.7}
                        onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="pt-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="proxyEnabled"
                          checked={formData.proxyEnabled || false}
                          onChange={(e) => update({ proxyEnabled: e.target.checked })}
                          className="h-3 w-3"
                        />
                        <label htmlFor="proxyEnabled" className="text-xs">{t('aiProvider.enableProxy')}</label>
                      </div>
                      {formData.proxyEnabled && (
                        <div className="mt-2">
                          <label htmlFor="provider-proxy-url" className="text-xs font-medium">{t('aiProvider.proxyUrl')}</label>
                          <input
                            id="provider-proxy-url"
                            type="text"
                            value={formData.proxyUrl || ''}
                            onChange={(e) => update({ proxyUrl: e.target.value })}
                            placeholder="http://proxy.example.com:8080"
                            className={INPUT_CLS}
                          />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {duplicateError && (
                <Card>
                  <CardContent className="p-4">
                    <div role="alert" className="flex items-center gap-2 text-sm text-red-600">
                      <XCircle className="h-4 w-4" />
                      <span>{t('aiProvider.duplicateError')}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {testResult && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t('aiProvider.testResult')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`flex items-center gap-2 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                      {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      <span>{testResult.message}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>

          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={isTesting || !isComplete}>
              {isTesting ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Play className="h-3 w-3 mr-2" />}
              {isTesting ? t('aiProvider.testing') : t('config.testConnection')}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleSave}>
                {mode === 'create' ? t('aiProvider.create') : t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('aiProvider.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('aiProvider.discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('aiProvider.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscardOpen(false)
                onOpenChange(false)
              }}
            >
              {t('aiProvider.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
