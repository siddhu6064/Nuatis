import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'

type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused'
type SubscriptionPlan = 'starter' | 'growth' | 'pro'

interface Tenant {
  name: string
  vertical: string
  subscription_status: SubscriptionStatus
  subscription_plan: SubscriptionPlan
}

const VERTICAL_LABEL: Record<string, string> = {
  sales_crm: 'Sales CRM',
  dental: 'Dental',
  salon: 'Salon',
  restaurant: 'Restaurant',
  contractor: 'Contractor',
  law_firm: 'Law Firm',
  real_estate: 'Real Estate',
}

const STATUS_STYLE: Record<SubscriptionStatus, string> = {
  active: 'bg-green-50 text-green-700',
  trialing: 'bg-amber-50 text-amber-700',
  past_due: 'bg-red-50 text-red-600',
  canceled: 'bg-red-50 text-red-600',
  unpaid: 'bg-red-50 text-red-600',
  paused: 'bg-gray-100 text-gray-500',
}

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Past Due',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  paused: 'Paused',
}

const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-4 border-b border-gray-50 last:border-0">
      <p className="text-sm text-gray-500 w-40 shrink-0">{label}</p>
      <div className="text-sm text-gray-900 text-right">{value}</div>
    </div>
  )
}

export default async function SettingsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const email = session?.user?.email ?? '—'

  const supabase = createAdminClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, vertical, subscription_status, subscription_plan')
    .eq('id', tenantId)
    .single<Tenant>()

  const status = tenant?.subscription_status ?? 'trialing'
  const plan = tenant?.subscription_plan ?? 'starter'

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and subscription</p>
      </div>

      <div className="max-w-xl space-y-6">
        {/* Business Profile */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Business Profile</h2>
          <p className="text-xs text-gray-400 mb-4">Your business details — read-only for now</p>

          <Row label="Business name" value={tenant?.name ?? '—'} />
          <Row
            label="Vertical"
            value={VERTICAL_LABEL[tenant?.vertical ?? ''] ?? tenant?.vertical ?? '—'}
          />
          <Row label="Owner email" value={email} />
          <Row
            label="Tenant ID"
            value={<span className="text-[11px] font-mono text-gray-400">{tenantId ?? '—'}</span>}
          />
        </div>

        {/* Subscription */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Subscription</h2>
          <p className="text-xs text-gray-400 mb-4">Your current plan and billing status</p>

          <Row
            label="Status"
            value={
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[status]}`}
              >
                {STATUS_LABEL[status]}
              </span>
            }
          />
          <Row label="Plan" value={PLAN_LABEL[plan]} />
          <Row
            label="Billing"
            value={<span className="text-gray-400">Billing management coming soon</span>}
          />
          <Row
            label="Voice AI"
            value={<span className="text-gray-400">Available in Phase 2</span>}
          />
        </div>
      </div>
    </div>
  )
}
