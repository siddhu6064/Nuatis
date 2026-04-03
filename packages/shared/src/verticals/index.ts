export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean'

export interface VerticalField {
  key: string
  label: string
  type: FieldType
  required: boolean
  options?: string[]
}

export interface PipelineStageConfig {
  name: string
  position: number
  color: string
  is_default?: boolean
  is_terminal?: boolean
}

export interface VerticalConfig {
  slug: string
  label: string
  fields: VerticalField[]
  pipeline_stages: PipelineStageConfig[]
  system_prompt_template: string
}

export const VERTICALS: Record<string, VerticalConfig> = {
  sales_crm: {
    slug: 'sales_crm',
    label: 'Sales CRM',
    fields: [
      { key: 'company', label: 'Company', type: 'text', required: true },
      {
        key: 'vertical_interest',
        label: 'Vertical interest',
        type: 'select',
        required: false,
        options: ['dental', 'salon', 'restaurant', 'contractor', 'law_firm', 'real_estate'],
      },
      {
        key: 'demo_status',
        label: 'Demo status',
        type: 'select',
        required: false,
        options: ['not_contacted', 'demo_scheduled', 'demo_done', 'pilot', 'paying', 'lost'],
      },
      { key: 'follow_up_date', label: 'Follow-up date', type: 'date', required: false },
      { key: 'notes', label: 'Notes', type: 'textarea', required: false },
    ],
    pipeline_stages: [
      { name: 'Prospect', position: 1, color: '#888780', is_default: true },
      { name: 'Demo scheduled', position: 2, color: '#378ADD' },
      { name: 'Demo done', position: 3, color: '#EF9F27' },
      { name: 'Pilot', position: 4, color: '#7F77DD' },
      { name: 'Paying', position: 5, color: '#1D9E75' },
      { name: 'Lost', position: 6, color: '#E05252', is_terminal: true },
    ],
    system_prompt_template:
      'You are Maya, a friendly bilingual AI assistant for {{business_name}}. You speak English and Spanish fluently. Always respond in the same language the caller uses. Help callers learn about the product, book demos, and answer questions. Be warm and professional.',
  },

  dental: {
    slug: 'dental',
    label: 'Dental practice',
    fields: [
      { key: 'date_of_birth', label: 'Date of birth', type: 'date', required: false },
      { key: 'insurance_provider', label: 'Insurance provider', type: 'text', required: false },
      { key: 'insurance_plan_id', label: 'Plan ID', type: 'text', required: false },
      { key: 'last_cleaning_date', label: 'Last cleaning date', type: 'date', required: false },
      {
        key: 'recall_interval_months',
        label: 'Recall interval (months)',
        type: 'number',
        required: false,
      },
      { key: 'preferred_dentist', label: 'Preferred dentist', type: 'text', required: false },
      {
        key: 'treatment_plan_status',
        label: 'Treatment plan status',
        type: 'select',
        required: false,
        options: ['none', 'active', 'completed', 'pending'],
      },
      { key: 'allergies', label: 'Allergies', type: 'text', required: false },
      { key: 'hipaa_consent_date', label: 'HIPAA consent date', type: 'date', required: false },
    ],
    pipeline_stages: [
      { name: 'New inquiry', position: 1, color: '#888780', is_default: true },
      { name: 'Consultation booked', position: 2, color: '#378ADD' },
      { name: 'Treatment planned', position: 3, color: '#EF9F27' },
      { name: 'Active patient', position: 4, color: '#1D9E75' },
      { name: 'Recall due', position: 5, color: '#D85A30' },
    ],
    system_prompt_template:
      "You are Maya, the AI receptionist for {{business_name}} dental practice. You speak English and Spanish. Help patients book appointments, answer questions about services, and handle recalls. Always respond in the caller's language.",
  },

  salon: {
    slug: 'salon',
    label: 'Hair salon',
    fields: [
      { key: 'preferred_stylist', label: 'Preferred stylist', type: 'text', required: false },
      { key: 'last_service', label: 'Last service', type: 'text', required: false },
      { key: 'last_service_date', label: 'Last service date', type: 'date', required: false },
      {
        key: 'hair_type',
        label: 'Hair type',
        type: 'select',
        required: false,
        options: ['fine', 'medium', 'coarse', 'curly', 'wavy'],
      },
      { key: 'product_allergies', label: 'Product allergies', type: 'text', required: false },
      {
        key: 'rebooking_interval_weeks',
        label: 'Rebooking interval (weeks)',
        type: 'number',
        required: false,
      },
      { key: 'color_formula', label: 'Colour formula notes', type: 'textarea', required: false },
      { key: 'birthday', label: 'Birthday', type: 'date', required: false },
    ],
    pipeline_stages: [
      { name: 'New client', position: 1, color: '#888780', is_default: true },
      { name: 'First booked', position: 2, color: '#378ADD' },
      { name: 'Returning', position: 3, color: '#1D9E75' },
      { name: 'VIP', position: 4, color: '#7F77DD' },
      { name: 'Lapsed', position: 5, color: '#D85A30' },
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}. You speak English and Spanish. Help clients book hair and beauty appointments, check availability, and answer service questions.',
  },

  restaurant: {
    slug: 'restaurant',
    label: 'Restaurant',
    fields: [
      { key: 'party_size_preference', label: 'Usual party size', type: 'number', required: false },
      { key: 'seating_preference', label: 'Seating preference', type: 'text', required: false },
      { key: 'dietary_restrictions', label: 'Dietary restrictions', type: 'text', required: false },
      { key: 'last_visit_date', label: 'Last visit', type: 'date', required: false },
      { key: 'vip_status', label: 'VIP', type: 'boolean', required: false },
      { key: 'birthday', label: 'Birthday', type: 'date', required: false },
      { key: 'anniversary', label: 'Anniversary', type: 'date', required: false },
      { key: 'no_show_count', label: 'No-show count', type: 'number', required: false },
    ],
    pipeline_stages: [
      { name: 'New guest', position: 1, color: '#888780', is_default: true },
      { name: 'Returning', position: 2, color: '#1D9E75' },
      { name: 'Regular', position: 3, color: '#378ADD' },
      { name: 'VIP', position: 4, color: '#7F77DD' },
    ],
    system_prompt_template:
      'You are Maya, the AI host for {{business_name}}. You speak English and Spanish. Help guests make reservations, answer questions about the menu and hours, and handle special requests.',
  },

  contractor: {
    slug: 'contractor',
    label: 'Contractor',
    fields: [
      { key: 'property_address', label: 'Property address', type: 'text', required: false },
      {
        key: 'property_type',
        label: 'Property type',
        type: 'select',
        required: false,
        options: ['residential', 'commercial'],
      },
      { key: 'last_job_type', label: 'Last job type', type: 'text', required: false },
      { key: 'last_job_date', label: 'Last job date', type: 'date', required: false },
      {
        key: 'estimate_status',
        label: 'Estimate status',
        type: 'select',
        required: false,
        options: ['none', 'sent', 'accepted', 'expired', 'rejected'],
      },
      { key: 'warranty_expiry_date', label: 'Warranty expiry', type: 'date', required: false },
      { key: 'referral_source', label: 'Referral source', type: 'text', required: false },
      { key: 'permit_notes', label: 'Permit notes', type: 'textarea', required: false },
    ],
    pipeline_stages: [
      { name: 'New lead', position: 1, color: '#888780', is_default: true },
      { name: 'Estimate sent', position: 2, color: '#378ADD' },
      { name: 'Estimate accepted', position: 3, color: '#EF9F27' },
      { name: 'Job scheduled', position: 4, color: '#1D9E75' },
      { name: 'Job completed', position: 5, color: '#7F77DD' },
    ],
    system_prompt_template:
      'You are Maya, the scheduling assistant for {{business_name}}. You speak English and Spanish. Help customers book estimates, follow up on jobs, and answer service questions.',
  },

  law_firm: {
    slug: 'law_firm',
    label: 'Law firm',
    fields: [
      { key: 'matter_number', label: 'Matter number', type: 'text', required: false },
      {
        key: 'case_type',
        label: 'Case type',
        type: 'select',
        required: false,
        options: [
          'family',
          'criminal_defense',
          'personal_injury',
          'corporate',
          'real_estate',
          'immigration',
          'other',
        ],
      },
      { key: 'assigned_attorney', label: 'Assigned attorney', type: 'text', required: false },
      {
        key: 'retainer_status',
        label: 'Retainer status',
        type: 'select',
        required: false,
        options: ['active', 'depleted', 'unpaid', 'none'],
      },
      { key: 'next_court_date', label: 'Next court date', type: 'date', required: false },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: false },
      {
        key: 'conflict_check_status',
        label: 'Conflict check',
        type: 'select',
        required: false,
        options: ['pending', 'cleared', 'conflict'],
      },
      {
        key: 'case_status',
        label: 'Case status',
        type: 'select',
        required: false,
        options: ['active', 'closed', 'pending', 'settled'],
      },
    ],
    pipeline_stages: [
      { name: 'New inquiry', position: 1, color: '#888780', is_default: true },
      { name: 'Conflict check', position: 2, color: '#378ADD' },
      { name: 'Consultation set', position: 3, color: '#EF9F27' },
      { name: 'Retained', position: 4, color: '#1D9E75' },
      { name: 'Active matter', position: 5, color: '#7F77DD' },
    ],
    system_prompt_template:
      'You are Maya, the intake assistant for {{business_name}} law firm. You speak English and Spanish. Help potential clients schedule consultations and answer general questions. Never give legal advice.',
  },

  real_estate: {
    slug: 'real_estate',
    label: 'Real estate',
    fields: [
      {
        key: 'buyer_or_seller',
        label: 'Buyer or seller',
        type: 'select',
        required: false,
        options: ['buyer', 'seller', 'both'],
      },
      { key: 'budget_max', label: 'Budget max ($)', type: 'number', required: false },
      { key: 'target_neighborhoods', label: 'Target neighborhoods', type: 'text', required: false },
      {
        key: 'pre_approval_status',
        label: 'Pre-approval status',
        type: 'select',
        required: false,
        options: ['none', 'in_progress', 'approved'],
      },
      { key: 'assigned_agent', label: 'Assigned agent', type: 'text', required: false },
      { key: 'target_close_date', label: 'Target close date', type: 'date', required: false },
      { key: 'showings_count', label: 'Showings count', type: 'number', required: false },
      { key: 'last_showing_address', label: 'Last showing address', type: 'text', required: false },
    ],
    pipeline_stages: [
      { name: 'New lead', position: 1, color: '#888780', is_default: true },
      { name: 'Qualified', position: 2, color: '#378ADD' },
      { name: 'Showing booked', position: 3, color: '#EF9F27' },
      { name: 'Offer stage', position: 4, color: '#D85A30' },
      { name: 'Under contract', position: 5, color: '#1D9E75' },
    ],
    system_prompt_template:
      'You are Maya, the assistant for {{business_name}} real estate. You speak English and Spanish. Help clients schedule property viewings, answer listing questions, and connect with agents.',
  },
}

export const VERTICAL_SLUGS = Object.keys(VERTICALS) as (keyof typeof VERTICALS)[]

export function getVertical(slug: string): VerticalConfig {
  const config = VERTICALS[slug]
  if (!config) throw new Error(`Unknown vertical: ${slug}`)
  return config
}
