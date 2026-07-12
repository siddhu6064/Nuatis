/**
 * Pure trial-expiry rule. No I/O, no async — fully unit-testable.
 *
 * Ownership split:
 *   - stripe_subscription_id set → Stripe owns the lifecycle. Never expired
 *     by us; subscription_status (via requirePlan) is the authority. This
 *     prevents locking out a paying customer in the gap between Stripe's
 *     trial ending and its webhook landing.
 *   - stripe_subscription_id null → self-serve trial we own. Expired only
 *     when now is past trial_ends_at plus the grace window.
 *
 * FAIL OPEN, unlike every other gate in this codebase: a null or unparseable
 * trial_ends_at allows access. Locking a small business out of their own
 * phone line over a bad row is worse than three extra days of free access.
 */
export const TRIAL_GRACE_DAYS = 3

const GRACE_MS = TRIAL_GRACE_DAYS * 24 * 60 * 60 * 1000

export function isTrialExpired(
  t: {
    stripe_subscription_id: string | null
    trial_ends_at: string | null
  },
  now: Date = new Date()
): boolean {
  if (t.stripe_subscription_id) return false
  if (!t.trial_ends_at) return false
  const endsAt = Date.parse(t.trial_ends_at)
  if (Number.isNaN(endsAt)) return false
  return now.getTime() > endsAt + GRACE_MS
}
