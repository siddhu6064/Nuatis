'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { usePostHog } from 'posthog-js/react'

/**
 * Identifies the authenticated user to PostHog using the DOMAIN user id
 * (appUserId = public.users.id) as the distinctId — the SAME value the
 * server-side activation events (1c) use, so client + server events stitch to
 * one person. Fires identify() + register() once per user (deduped on
 * appUserId). No-ops entirely when PostHog is uninitialized (no key) or the
 * session is unauthenticated. Renders nothing.
 */
export function PostHogIdentify() {
  const posthog = usePostHog()
  const { data: session, status } = useSession()
  const identifiedFor = useRef<string | null>(null)

  useEffect(() => {
    // usePostHog() returns the global singleton even with no provider, so the
    // __loaded flag (true only after init) is the real "key is set" guard.
    if (!posthog || !posthog.__loaded) return
    if (status !== 'authenticated') return

    const user = session?.user
    const appUserId = user?.appUserId
    if (!appUserId) return
    if (identifiedFor.current === appUserId) return
    identifiedFor.current = appUserId

    const personProps: Record<string, string> = {}
    if (user.email) personProps.email = user.email
    if (user.tenantId) personProps.tenant_id = user.tenantId
    if (user.vertical) personProps.vertical = user.vertical
    if (user.subscriptionStatus) personProps.subscription_status = user.subscriptionStatus
    posthog.identify(appUserId, personProps)

    const superProps: Record<string, string> = {}
    if (user.tenantId) superProps.tenant_id = user.tenantId
    if (user.vertical) superProps.vertical = user.vertical
    if (user.subscriptionStatus) superProps.subscription_status = user.subscriptionStatus
    posthog.register(superProps)
  }, [posthog, status, session])

  return null
}
