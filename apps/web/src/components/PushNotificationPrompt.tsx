'use client'

import { useState, useEffect } from 'react'

export function PushNotificationPrompt() {
  const [show, setShow] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (Notification.permission === 'granted') return
    if (Notification.permission === 'denied') return
    if (sessionStorage.getItem('push-dismissed')) return
    setShow(true)
  }, [])

  async function subscribe() {
    setSubscribing(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setShow(false)
        return
      }

      const reg = await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) {
        setShow(false)
        return
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      })

      setShow(false)
    } catch {
      setShow(false)
    } finally {
      setSubscribing(false)
    }
  }

  function dismiss() {
    sessionStorage.setItem('push-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="bg-teal-50 border-b border-teal-100 px-4 py-2 flex items-center justify-between">
      <p className="text-xs text-teal-700">
        Enable notifications to get alerts for missed calls and new leads
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={subscribe}
          disabled={subscribing}
          className="text-xs font-medium text-teal-700 bg-teal-100 px-2.5 py-1 rounded hover:bg-teal-200 disabled:opacity-50"
        >
          {subscribing ? 'Enabling...' : 'Enable'}
        </button>
        <button onClick={dismiss} className="text-xs text-teal-500 hover:text-teal-700">
          Not now
        </button>
      </div>
    </div>
  )
}
