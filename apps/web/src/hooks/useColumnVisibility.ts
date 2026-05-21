'use client'
import { useState, useEffect } from 'react'

export function useColumnVisibility(storageKey: string, defaults: Record<string, boolean>) {
  const [visible, setVisible] = useState<Record<string, boolean>>(defaults)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        setVisible({ ...defaults, ...JSON.parse(stored) })
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  function toggle(key: string, isVisible: boolean) {
    const next = { ...visible, [key]: isVisible }
    setVisible(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
  }

  return { visible, toggle }
}
