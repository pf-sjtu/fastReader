import React, { useEffect, useState } from 'react';
import { ThemeProviderContext, type Theme } from './useTheme';

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultTheme = 'system',
  storageKey = 'ebook-to-mindmap-theme',
}) => {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;

    // 切换主题的那一帧关掉所有过渡：否则带 transition-all/colors 的控件会用 150ms 渐变到新主题，
    // 其它元素立刻变色，就出现「深色卡片 + 浅色文字」的混合帧
    root.setAttribute('data-theme-switching', '')
    const done = requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')))

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      return () => cancelAnimationFrame(done);
    }

    root.classList.add(theme);
    return () => cancelAnimationFrame(done);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
};
