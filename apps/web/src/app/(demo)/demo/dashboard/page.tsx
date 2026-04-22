'use client'

import { useState } from 'react'

import { VerticalSwitcher } from '@/components/crm/VerticalSwitcher'
import { VerticalFieldRenderer } from '@/components/crm/VerticalFieldRenderer'
import { getVertical, type PipelineStageConfig } from '@nuatis/shared'

// Demo seed data per vertical — shown during prospect calls
const DEMO_DATA: Record<string, Record<string, unknown>> = {
  sales_crm: {
    company: 'Acme Corp',
    vertical_interest: 'dental',
    demo_status: 'demo_scheduled',
    follow_up_date: '2026-04-01',
  },
  dental: {
    date_of_birth: '1985-03-22',
    insurance_provider: 'Delta Dental',
    last_cleaning_date: '2025-09-15',
    recall_interval_months: 6,
    preferred_dentist: 'Dr. Sarah Kim',
    treatment_plan_status: 'active',
  },
  salon: {
    preferred_stylist: 'Jamie Chen',
    last_service: 'Full balayage',
    last_service_date: '2025-11-01',
    hair_type: 'fine',
    rebooking_interval_weeks: 8,
  },
  restaurant: {
    party_size_preference: 2,
    seating_preference: 'Corner booth',
    dietary_restrictions: 'Gluten-free',
    vip_status: true,
    last_visit_date: '2026-01-05',
  },
  contractor: {
    property_address: '4521 Oak Lane, Austin TX',
    property_type: 'residential',
    last_job_type: 'HVAC installation',
    estimate_status: 'accepted',
    warranty_expiry_date: '2026-06-20',
  },
  law_firm: {
    matter_number: '2024-CR-00142',
    case_type: 'criminal_defense',
    assigned_attorney: 'David Okonkwo',
    retainer_status: 'active',
    conflict_check_status: 'cleared',
    case_status: 'active',
  },
  real_estate: {
    buyer_or_seller: 'buyer',
    budget_max: 600000,
    target_neighborhoods: 'South Congress, Travis Heights',
    pre_approval_status: 'approved',
    assigned_agent: 'Rebecca Stone',
  },
}

export default function DemoDashboardPage() {
  const [activeSlug, setActiveSlug] = useState('sales_crm')
  const vertical = getVertical(activeSlug)
  const demoValues = DEMO_DATA[activeSlug] ?? {}

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">N</span>
          </div>
          <span className="font-semibold text-gray-900">Nuatis</span>
          <span className="text-gray-300 mx-1">·</span>
          <span className="text-sm text-gray-500">Demo</span>
        </div>
        <VerticalSwitcher currentSlug={activeSlug} onSwitch={setActiveSlug} />
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Contact card header */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Jane Smith</h1>
              <p className="text-sm text-gray-500 mt-0.5">jane@example.com · +1 (512) 555-0100</p>
            </div>
            <span
              className="text-xs bg-teal-50 text-teal-700 border border-teal-200
                             px-2 py-1 rounded-full font-medium"
            >
              {vertical.label}
            </span>
          </div>

          {/* Dynamic vertical fields */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              {vertical.label} details
            </p>
            <VerticalFieldRenderer
              fields={vertical.fields}
              values={demoValues}
              onChange={() => {}}
              readOnly={true}
            />
          </div>
        </div>

        {/* Pipeline stages */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Pipeline
          </p>
          <div className="flex gap-2 flex-wrap">
            {vertical.pipeline_stages.map((stage: PipelineStageConfig, i: number) => (
              <div
                key={stage.name}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-medium border
                  ${i === 0 ? 'border-2 text-white' : 'bg-gray-50 text-gray-600 border-gray-200'}
                `}
                style={i === 0 ? { backgroundColor: stage.color, borderColor: stage.color } : {}}
              >
                {stage.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
