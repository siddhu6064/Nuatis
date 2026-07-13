/**
 * Pure read-only-state rule. No I/O, no async — fully unit-testable.
 *
 * NAMING NOTE: isTrialExpired is historical — it now answers "is this tenant
 * in the read-only state?" True for EITHER a self-serve trial past its grace
 * window OR a subscription in a non-entitled terminal status
 * (canceled / unpaid / paused). Kept to avoid a churny multi-file rename;
 * readOnlyReason below is the primary rule.
 *
 * Ownership split:
 *   - stripe_subscription_id set → Stripe owns the lifecycle. The trial-date
 *     branch never fires; only subscription_status can make the tenant
 *     read-only. past_due is deliberately NOT read-only — Stripe is still
 *     retrying dunning, and a genuinely failed card lands the tenant in
 *     canceled/unpaid via webhook on its own.
 *   - stripe_subscription_id null → self-serve trial we own. Read-only only
 *     when now is past trial_ends_at plus the grace window.
 *
 * FAIL OPEN, unlike every other gate in this codebase: a null or unparseable
 * trial_ends_at allows access. Locking a small business out of their own
 * phone line over a bad row is worse than three extra days of free access.
 */
export const TRIAL_GRACE_DAYS = 3

const GRACE_MS = TRIAL_GRACE_DAYS * 24 * 60 * 60 * 1000

export type ReadOnlyReason =
  | 'trial_expired'
  | 'subscription_canceled'
  | 'subscription_unpaid'
  | 'subscription_paused'

interface TenantBillingState {
  stripe_subscription_id: string | null
  trial_ends_at: string | null
  /** Optional so pre-existing two-field callers keep working unchanged. */
  subscription_status?: string | null
}

/** Why the tenant is read-only, or null if fully entitled. */
export function readOnlyReason(
  t: TenantBillingState,
  now: Date = new Date()
): ReadOnlyReason | null {
  const status = t.subscription_status ?? null
  // 'cancelled' (two Ls) is enum pollution — rows exist even though we only
  // ever write single-L 'canceled'. Both spellings mean the same thing.
  if (status === 'canceled' || status === 'cancelled') return 'subscription_canceled'
  if (status === 'unpaid') return 'subscription_unpaid'
  if (status === 'paused') return 'subscription_paused'
  // trialing / active / past_due / incomplete fall through to the trial rule.
  if (t.stripe_subscription_id) return null
  if (!t.trial_ends_at) return null
  const endsAt = Date.parse(t.trial_ends_at)
  if (Number.isNaN(endsAt)) return null
  return now.getTime() > endsAt + GRACE_MS ? 'trial_expired' : null
}

/** Historical name — see header. True ⇔ readOnlyReason() is non-null. */
export function isTrialExpired(t: TenantBillingState, now: Date = new Date()): boolean {
  return readOnlyReason(t, now) !== null
}

/** Honest name for new call sites — same rule, do not rename existing callers. */
export const isReadOnly = isTrialExpired
