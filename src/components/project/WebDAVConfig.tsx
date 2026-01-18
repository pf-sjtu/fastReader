import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { 
  Settings, 
  ExternalLink, 
  Info, 
  CheckCircle, 
  XCircle, 
  Loader2,
  FolderOpen,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useWebDAVConfig, useConfigStore } from '../../stores/configStore'
import { webdavService } from '../../services/webdavService'
import { useTranslation } from 'react-i18next'

export function WebDAVConfig() {
  const { t } = useTranslation()
  const webdavConfig = useWebDAVConfig()
  const {
    setWebDAVEnabled,
    setWebDAVServerUrl,
    setWebDAVUsername,
    setWebDAVPassword,
    setWebDAVAppName,
    setWebDAVAutoSync,
    setWebDAVSyncPath,
    setWebDAVConnectionStatus,
    updateWebDAVLastSyncTime,
    resetWebDAVConfig
  } = useConfigStore()

  // 组件状态
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [lastConfigHash, setLastConfigHash] = useState('')

  // 检查WebDAV服务状态
  useEffect(() => {
    setIsInitialized(webdavService.isInitialized())
  }, [webdavConfig])

  // 生成配置哈希用于检测配置变化
  const getConfigHash = () => {
    return `${webdavConfig.enabled}-${webdavConfig.serverUrl}-${webdavConfig.username}-${webdavConfig.password}`
  }

  // 当WebDAV功能启用且配置完整时，自动测试连接
  useEffect(() => {
    const currentHash = getConfigHash()
    
    // 只有配置真正变化时才重新测试
    if (currentHash !== lastConfigHash &&
        webdavConfig.enabled && 
        webdavConfig.serverUrl && 
        webdavConfig.username && 
        webdavConfig.password &&
        !isTestingConnection) {
      
      // 更新配置哈希
      setLastConfigHash(currentHash)
      
      // 延迟一下自动测试，避免频繁触发
      const timer = setTimeout(() => {
        console.log('WebDAV配置完整，自动测试连接...')
        testConnection()
      }, 1000)
      
      return () => clearTimeout(timer)
    }
  }, [webdavConfig.enabled, webdavConfig.serverUrl, webdavConfig.username, webdavConfig.password, isTestingConnection, lastConfigHash])

  // 测试WebDAV连接
  const testConnection = async () => {
    if (!webdavConfig.serverUrl || !webdavConfig.username || !webdavConfig.password) {
      setConnectionTestResult({
        success: false,
        message: '请填写完整的WebDAV配置信息'
      })
      return
    }

    setIsTestingConnection(true)
    setWebDAVConnectionStatus('connecting')
    setConnectionTestResult(null)

    try {
      // 初始化WebDAV服务
      const initResult = await webdavService.initialize(webdavConfig)
      
      if (!initResult.success) {
        setWebDAVConnectionStatus('error')
        setConnectionTestResult({
          success: false,
          message: initResult.error || '连接失败'
        })
        return
      }

      // 测试连接
      const testResult = await webdavService.testConnection()
      
      if (testResult.success) {
        setWebDAVConnectionStatus('connected')
        setConnectionTestResult({
          success: true,
          message: 'WebDAV连接测试成功！'
        })
      } else {
        setWebDAVConnectionStatus('error')
        setConnectionTestResult({
          success: false,
          message: testResult.error || '连接测试失败'
        })
      }
    } catch (error) {
      setWebDAVConnectionStatus('error')
      setConnectionTestResult({
        success: false,
        message: `连接测试异常: ${error instanceof Error ? error.message : '未知错误'}`
      })
    } finally {
      setIsTestingConnection(false)
    }
  }

  // 重置配置
  const handleReset = () => {
    resetWebDAVConfig()
    setConnectionTestResult(null)
    webdavService.disconnect()
    setIsInitialized(false)
  }

  // 获取连接状态图标
  const getConnectionStatusIcon = () => {
    switch (webdavConfig.connectionStatus) {
      case 'connected':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'connecting':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <XCircle className="h-4 w-4 text-gray-400" />
    }
  }

  // 获取连接状态文本
  const getConnectionStatusText = () => {
    switch (webdavConfig.connectionStatus) {
      case 'connected':
        return '已连接'
      case 'connecting':
        return '连接中...'
      case 'error':
        return '连接失败'
      default:
        return '未连接'
    }
  }

  return (
    <div className="space-y-6">
      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="webdav-enabled" className="text-base font-medium">
            启用WebDAV同步
          </Label>
          <p className="text-sm text-muted-foreground">
            启用后可以将处理后的文件自动同步到WebDAV服务器
          </p>
        </div>
        <Switch
          id="webdav-enabled"
          checked={webdavConfig.enabled}
          onCheckedChange={setWebDAVEnabled}
        />
      </div>

      <Separator />

      {webdavConfig.enabled && (
        <>
          {/* 服务器配置 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                服务器配置
              </CardTitle>
              <CardDescription>
                配置WebDAV服务器的连接信息
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="server-url">服务器地址</Label>
                <Input
                  id="server-url"
                  placeholder="https://dav.jianguoyun.com/dav/"
                  value={webdavConfig.serverUrl}
                  onChange={(e) => setWebDAVServerUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  placeholder="your-email@example.com"
                  value={webdavConfig.username}
                  onChange={(e) => setWebDAVUsername(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="应用密码"
                    value={webdavConfig.password}
                    onChange={(e) => setWebDAVPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="app-name">应用名称</Label>
                <Input
                  id="app-name"
                  placeholder="fastReader_by_PF"
                  value={webdavConfig.appName}
                  onChange={(e) => setWebDAVAppName(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* 连接测试 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                连接测试
              </CardTitle>
              <CardDescription>
                测试WebDAV服务器连接是否正常
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getConnectionStatusIcon()}
                  <span className="text-sm">{getConnectionStatusText()}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testConnection}
                    disabled={isTestingConnection}
                  >
                    {isTestingConnection ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        测试中...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        测试连接
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                  >
                    重置
                  </Button>
                </div>
              </div>

              {connectionTestResult && (
                <Alert className={connectionTestResult.success ? 'border-green-200' : 'border-red-200'}>
                  <AlertDescription>
                    {connectionTestResult.message}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* 同步设置 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                同步设置
              </CardTitle>
              <CardDescription>
                配置文件同步的相关选项
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-sync">自动同步</Label>
                  <p className="text-sm text-muted-foreground">
                    处理完成后自动同步文件到WebDAV
                  </p>
                </div>
                <Switch
                  id="auto-sync"
                  checked={webdavConfig.autoSync}
                  onCheckedChange={setWebDAVAutoSync}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sync-path">同步路径</Label>
                <Input
                  id="sync-path"
                  placeholder="/fastReader"
                  value={webdavConfig.syncPath}
                  onChange={(e) => setWebDAVSyncPath(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  文件将同步到此路径下的相应文件夹中
                </p>
              </div>

              {webdavConfig.lastSyncTime && (
                <div className="text-sm text-muted-foreground">
                  最后同步时间: {new Date(webdavConfig.lastSyncTime).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 帮助信息 */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p>
                  <strong>坚果云WebDAV配置说明：</strong>
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>服务器地址：https://dav.jianguoyun.com/dav/</li>
                  <li>用户名：坚果云账户邮箱</li>
                  <li>密码：在坚果云安全选项中生成的应用密码</li>
                  <li>应用密码不是登录密码，需要在账户设置中单独生成</li>
                </ul>
                <div className="flex items-center gap-2 pt-2">
                  <ExternalLink className="h-4 w-4" />
                  <a 
                    href="https://help.jianguoyun.com/?p=1464" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    查看坚果云WebDAV设置教程
                  </a>
                </div>
                <p className="text-sm text-muted-foreground">
                  当前版本通过同源 `/api/dav` 代理访问 WebDAV，请确保服务器地址为 https。
                </p>
              </div>
            </AlertDescription>
          </Alert>

        </>
      )}
    </div>
  )
}
