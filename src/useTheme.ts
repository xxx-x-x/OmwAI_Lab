import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark'
export const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: 'light', toggleTheme: () => {} })

export function useTheme() { return useContext(ThemeContext) }
