import { useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from './useTheme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    setTheme(next)
    try { localStorage.setItem('omwai-theme', next) } catch { /* Storage may be disabled by the browser. */ }
  }
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

