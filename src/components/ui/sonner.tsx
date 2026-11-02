import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useIsDarkMode } from "@/components/useTheme"

/**
 * Toast 容器的主题必须跟**应用内**的明暗开关走。
 * 这里原先用 next-themes 的 `useTheme()`，但本应用挂的是自研的 ThemeProvider（见 main.tsx），
 * next-themes 的 Provider 从未挂载 → 它永远返回 "system"，toast 配色跟操作系统而不是用户的开关。
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const isDark = useIsDarkMode()

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
