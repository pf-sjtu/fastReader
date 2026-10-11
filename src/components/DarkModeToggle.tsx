import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './useTheme';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

export const DarkModeToggle: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const toggleDarkMode = () => {
    if (theme === 'dark') {
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
      title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {theme === 'dark' ? t('theme.light') : t('theme.dark')}
      </span>
    </Button>
  );
};
