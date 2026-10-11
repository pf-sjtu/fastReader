import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './useTheme';
import { Button } from '@/components/ui/button';

export const DarkModeToggle: React.FC = () => {
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
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {theme === 'dark' ? '浅色' : '深色'}
      </span>
    </Button>
  );
};
