import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ThemeProvider } from './components/ThemeProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthGate } from './components/auth/AuthGate'
import { installPricingProviders } from './services/pricingBridge'
// 注册 modelQuirks 共享分区：启动时导入各模型已验证的参数怪癖，运行中学到的新值上报后端
import './stores/modelQuirks'

// 汇率/价格来自共享配置：启动时装好取数钩子
installPricingProviders()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
