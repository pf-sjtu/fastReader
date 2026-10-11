import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from './useTheme';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';

export const ThemeSwitcher: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const themes = [
    { name: 'light', icon: Sun, label: t('theme.light') },
    { name: 'dark', icon: Moon, label: t('theme.dark') },
    { name: 'system', icon: Monitor, label: t('theme.system') },
  ] as const;

  return (
    <div className={cn('flex items-center space-x-2', className)}>
      {themes.map(({ name, icon: Icon, label }) => (
        <button
          key={name}
          onClick={() => setTheme(name)}
          className={cn(
            'p-2 rounded-md transition-colors',
            theme === name
              ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
          )}
          title={label}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
};
