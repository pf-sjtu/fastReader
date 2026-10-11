import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme, useIsDarkMode } from './useTheme';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

export const DarkModeToggle: React.FC = () => {
  const { t } = useTranslation();
  const { setTheme } = useTheme();
  // 基于实际生效主题取反：theme 为 system 时也要让首次点击有可见变化
  const isDark = useIsDarkMode();

  const toggleDarkMode = () => {
    if (isDark) {
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleDarkMode}
      className="flex items-center gap-2"
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
    >
      {isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {isDark ? t('theme.light') : t('theme.dark')}
      </span>
    </Button>
  );
};
