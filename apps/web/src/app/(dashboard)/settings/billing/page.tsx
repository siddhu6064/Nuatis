import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import BillingClient from './BillingClient'

type PlanKey = 'core' | 'pro' | 'scale'
type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | 'unpaid'

interface TenantBilling {
  subscription_plan: PlanKey | null
  subscription_status: Status | null
  trial_ends_at: string | null
  current_period_end: string | null
  maya_minutes_used: number | null
  maya_minutes_limit: number | null
  maya_overage_rate: number | null
}

const PLAN_LABEL: Record<PlanKey, string> = {
  core: 'Core',
  pro: 'Pro',
  scale: 'Scale',
}

const PLAN_PRICE: Record<PlanKey, string> = {
  core: '$149 / mo',
  pro: '$299 / mo',
  scale: '$499 / mo',
}

export default async function BillingSettingsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'subscription_plan, subscription_status, trial_ends_at, current_period_end, maya_minutes_used, maya_minutes_limit, maya_overage_rate'
    )
    .eq('id', tenantId)
    .single<TenantBilling>()

  const plan = tenant?.subscription_plan ?? null
  const status: Status = (tenant?.subscription_status as Status | null) ?? 'trialing'
  const trialEndsAt = tenant?.trial_ends_at ?? null
  const periodEnd = tenant?.current_period_end ?? null
  const used = tenant?.maya_minutes_used ?? 0
  const limit = tenant?.maya_minutes_limit ?? null
  const overageRate = tenant?.maya_overage_rate ?? null

  return (
    <BillingClient
      plan={plan}
      status={status}
      planLabel={plan ? PLAN_LABEL[plan] : null}
      planPrice={plan ? PLAN_PRICE[plan] : null}
      trialEndsAt={trialEndsAt}
      currentPeriodEnd={periodEnd}
      mayaMinutesUsed={used}
      mayaMinutesLimit={limit}
      mayaOverageRate={overageRate}
    />
  )
}
