import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

// Theme from `?theme=`, then the OS. The docs page sends `zapyd:theme` when
// the reader toggles dark mode.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (new URLSearchParams(location.search).get('theme') as Theme) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  )

  // Flip the theme without every color transition firing at once.
  useEffect(() => {
    const off = document.createElement('style')
    off.textContent = '*,*::before,*::after{transition:none!important}'
    document.head.appendChild(off)
    document.documentElement.dataset.theme = theme
    void getComputedStyle(document.body).opacity
    requestAnimationFrame(() => off.remove())
  }, [theme])

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.type === 'zapyd:theme' && (e.data.theme === 'light' || e.data.theme === 'dark')) setTheme(e.data.theme)
    }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [])

  return [theme, setTheme] as const
}
