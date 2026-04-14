import { auth } from '@/lib/auth/authjs'
import { FOLLOW_UP_CADENCES } from '@/lib/verticals'
import FollowUpEditor from './FollowUpEditor'

const VERTICAL_LABELS: Record<string, string> = {
  sales_crm: 'Sales CRM',
  dental: 'Dental',
  salon: 'Salon',
  restaurant: 'Restaurant',
  contractor: 'Contractor',
  law_firm: 'Law Firm',
  real_estate: 'Real Estate',
}

export default async function FollowUpsPage() {
  const session = await auth()
  const vertical = session?.user?.vertical || 'sales_crm'
  const businessName = session?.user?.businessName || 'Your Business'

  const cadence = FOLLOW_UP_CADENCES[vertical] ?? []
  const verticalLabel = VERTICAL_LABELS[vertical] ?? vertical

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Follow-up Templates</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configured for: {verticalLabel}</p>
      </div>

      <FollowUpEditor
        cadence={cadence}
        verticalLabel={verticalLabel}
        businessName={businessName}
        telnyxNumber="+15127376388"
      />
    </div>
  )
}
