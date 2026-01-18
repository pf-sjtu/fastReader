import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Alert, AlertDescription } from './ui/alert'
import { 
  Settings, 
  ExternalLink, 
  Info, 
  CheckCircle, 
  XCircle, 
  Loader2,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useWebDAVConfig, useWebDAVStore } from '../stores/webdavStore'
import { webdavService } from '../services/webdavService'

export function WebDAVConfig() {
  const webdavConfig = useWebDAVConfig()
  const {
    setWebDAVEnabled,
    setWebDAVServerUrl,
    setWebDAVUsername,
    setWebDAVPassword,
    setWebDAVAppName,
    setWebDAVBrowsePath,
    setWebDAVSyncPath,
    setWebDAVConnectionStatus,
    resetWebDAVConfig
  } = useWebDAVStore()


  // 组件状态
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [lastConfigHash, setLastConfigHash] = useState('')

  // 检查WebDAV服务状态
  useEffect(() => {
    // 初始化逻辑
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
      if (webdavConfig.serverUrl.includes('dav.jianguoyun.com')) {
        console.info('WebDAV访问将使用同源代理')
      }


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
    <div className="space-y-4">
      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="webdav-enabled" className="text-sm font-medium">
            启用WebDAV文件访问
          </Label>
          <p className="text-xs text-muted-foreground">
            启用后可以从WebDAV服务器打开Markdown文件
          </p>
        </div>
        <Switch
          id="webdav-enabled"
          checked={webdavConfig.enabled}
          onCheckedChange={setWebDAVEnabled}
        />
      </div>

      {webdavConfig.enabled && (
        <>
          {/* 服务器配置 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Settings className="h-4 w-4" />
                服务器配置
              </CardTitle>
              <CardDescription className="text-xs">
                配置WebDAV服务器的连接信息
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-1">
                <Label htmlFor="server-url" className="text-xs">服务器地址</Label>
                <Input
                  id="server-url"
                  placeholder="https://dav.jianguoyun.com/dav/"
                  value={webdavConfig.serverUrl}
                  onChange={(e) => setWebDAVServerUrl(e.target.value)}
                  className="h-8"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="username" className="text-xs">用户名</Label>
                <Input
                  id="username"
                  placeholder="your-email@example.com"
                  value={webdavConfig.username}
                  onChange={(e) => setWebDAVUsername(e.target.value)}
                  className="h-8"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password" className="text-xs">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="应用密码"
                    value={webdavConfig.password}
                    onChange={(e) => setWebDAVPassword(e.target.value)}
                    className="h-8 pr-8"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-2 py-1 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="app-name" className="text-xs">应用名称</Label>
                <Input
                  id="app-name"
                  placeholder="md_reader_by_PF"
                  value={webdavConfig.appName}
                  onChange={(e) => setWebDAVAppName(e.target.value)}
                  className="h-8"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="browse-path" className="text-xs">浏览路径</Label>
                <Input
                  id="browse-path"
                  placeholder="/"
                  value={webdavConfig.browsePath}
                  onChange={(e) => setWebDAVBrowsePath(e.target.value)}
                  className="h-8"
                />
                <p className="text-xs text-muted-foreground">默认从该目录浏览 WebDAV</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="sync-path" className="text-xs">同步路径</Label>
                <Input
                  id="sync-path"
                  placeholder="/mdReader"
                  value={webdavConfig.syncPath}
                  onChange={(e) => setWebDAVSyncPath(e.target.value)}
                  className="h-8"
                />
                <p className="text-xs text-muted-foreground">输出文件写入该目录</p>
              </div>
            </CardContent>
          </Card>

          {/* 代理说明 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Settings className="h-4 w-4" />
                代理说明
              </CardTitle>
              <CardDescription className="text-xs">
                WebDAV 请求默认走同源代理以避免浏览器 CORS 问题
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Alert className="py-2">
                <Info className="h-3 w-3" />
                <AlertDescription className="text-xs">
                  <div className="space-y-1">
                    <p>无需手动开启代理，应用会自动通过同源 `/api/dav` 访问 WebDAV。</p>
                    <p>请确保服务器地址以 <code className="bg-muted px-1 py-0.5 rounded text-xs">https://</code> 开头。</p>
                  </div>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>



          {/* 连接测试 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <RefreshCw className="h-4 w-4" />
                连接测试
              </CardTitle>
              <CardDescription className="text-xs">
                测试WebDAV服务器连接是否正常
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getConnectionStatusIcon()}
                  <span className="text-xs">{getConnectionStatusText()}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testConnection}
                    disabled={isTestingConnection}
                    className="h-7 text-xs"
                  >
                    {isTestingConnection ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        测试中...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-1 h-3 w-3" />
                        测试连接
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="h-7 text-xs"
                  >
                    重置
                  </Button>
                </div>
              </div>

              {connectionTestResult && (
                <Alert className={connectionTestResult.success ? 'border-green-200' : 'border-red-200'}>
                  <AlertDescription className="text-xs">
                    {connectionTestResult.message}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* 帮助信息 */}
          <Alert className="py-2">
            <Info className="h-3 w-3" />
            <AlertDescription className="text-xs">
              <div className="space-y-2">
                <p>
                  <strong>坚果云WebDAV配置说明：</strong>
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>服务器地址：https://dav.jianguoyun.com/dav/</li>
                  <li>用户名：坚果云账户邮箱</li>
                  <li>密码：在坚果云安全选项中生成的应用密码</li>
                  <li>应用密码不是登录密码，需要在账户设置中单独生成</li>
                </ul>
                <div className="flex items-center gap-1 pt-1">
                  <ExternalLink className="h-3 w-3" />
                  <a 
                    href="https://help.jianguoyun.com/?p=1464" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs"
                  >
                    查看坚果云WebDAV设置教程
                  </a>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  )
}
