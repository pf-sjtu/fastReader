import { Bot, Globe, Settings, Shield, Zap } from 'lucide-react'

export function ProviderIcon({ provider }: { provider?: string }) {
  switch (provider) {
    case 'gemini':
      return <Bot className="h-4 w-4" />
    case 'openai':
      return <Zap className="h-4 w-4" />
    case 'ollama':
      return <Globe className="h-4 w-4" />
    case '302.ai':
      return <Shield className="h-4 w-4" />
    default:
      return <Settings className="h-4 w-4" />
  }
}
