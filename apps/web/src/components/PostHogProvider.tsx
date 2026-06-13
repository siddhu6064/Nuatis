'use client'

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { sanitizeEvent } from '@/lib/posthog-sanitizer'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST

/**
 * Manual $pageview capture for the App Router, which does NOT auto-fire
 * $pageview on client-side navigation. Fires once on mount and again whenever
 * the path or query string changes. No-ops when the client is unavailable.
 *
 * Reads useSearchParams, so it MUST live inside a <Suspense> boundary (below).
 */
function PageviewTracker() {
  const client = usePostHog()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!client || !pathname) return
    let url = window.origin + pathname
    const query = searchParams.toString()
    if (query) url += `?${query}`
    client.capture('$pageview', { $current_url: url })
  }, [client, pathname, searchParams])

  return null
}

/**
 * Initializes posthog-js client-side, once. When NEXT_PUBLIC_POSTHOG_KEY is
 * unset the SDK is never initialized and children render unchanged — dev/local
 * works with no key, no network calls, no console noise.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  const initialized = useRef(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (initialized.current || !POSTHOG_KEY) return
    initialized.current = true
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      capture_pageview: false,
      autocapture: true,
      disable_session_recording: true,
      cross_subdomain_cookie: true,
      before_send: sanitizeEvent,
    })
    setReady(true)
  }, [])

  if (!POSTHOG_KEY) return <>{children}</>

  return (
    <PHProvider client={posthog}>
      {ready && (
        <Suspense fallback={null}>
          <PageviewTracker />
        </Suspense>
      )}
      {children}
    </PHProvider>
  )
}
