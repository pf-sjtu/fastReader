// 登录页：共享密码登录（密码来自部署环境变量 APP_PASSWORD）
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LockKeyhole, Loader2, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { sharedApi, SharedApiError } from '@/services/shared/api'

interface LoginPageProps {
  onSuccess: () => void
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      await sharedApi.login(password)
      setPassword('')
      onSuccess()
    } catch (err) {
      if (err instanceof SharedApiError) {
        if (err.status === 429) setError(t('auth.tooManyAttempts'))
        else if (err.status === 401) setError(t('auth.invalidPassword'))
        else setError(t('auth.loginFailed'))
      } else {
        setError(t('auth.loginFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex justify-end gap-1.5 p-3">
        <LanguageSwitcher />
        <DarkModeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-2 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <LockKeyhole className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-xl">{t('auth.title')}</CardTitle>
            <CardDescription>{t('auth.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fr-password">{t('auth.passwordLabel')}</Label>
                <div className="relative">
                  <Input
                    id="fr-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    placeholder={t('auth.passwordPlaceholder')}
                    aria-invalid={!!error}
                    aria-describedby={error ? 'fr-password-error' : undefined}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-8 w-8"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {error && (
                  <p id="fr-password-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={submitting || password.length === 0}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('auth.submit')}
              </Button>

              <p className="text-xs text-muted-foreground text-center">{t('auth.hint')}</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
