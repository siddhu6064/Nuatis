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
  is_won?: boolean
  is_lost?: boolean
}

export interface BusinessHours {
  mon_fri: string
  sat: string
  sun: string
}

export interface FollowUpStep {
  days_after: number
  channel: 'sms' | 'email'
  subject?: string
  template: string
}

export interface VerticalConfig {
  slug: string
  label: string
  inventory_label: string
  staff_label: string
  fields: VerticalField[]
  pipeline_stages: PipelineStageConfig[]
  system_prompt_template: string
  business_hours: BusinessHours
  follow_up_cadence: FollowUpStep[]
  maya_intents?: string[]
}

const MAYA_PROMPT_SUFFIX =
  ' LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.'

// Pipeline stage colour palette (keep in sync with dashboard kanban + marketing popup)
const C = {
  blue: '#378ADD',
  amber: '#EF9F27',
  green: '#1D9E75',
  teal: '#2DA89C',
  gray: '#888780',
} as const

export const VERTICALS: Record<string, VerticalConfig> = {
  sales_crm: {
    slug: 'sales_crm',
    label: 'Sales CRM',
    inventory_label: 'Assets',
    staff_label: 'Team Members',
    fields: [
      { key: 'company_name', label: 'Company', type: 'text', required: true },
      { key: 'job_title', label: 'Job title', type: 'text', required: false },
      { key: 'industry', label: 'Industry', type: 'text', required: false },
      {
        key: 'company_size',
        label: 'Company size',
        type: 'select',
        required: false,
        options: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
      },
      { key: 'deal_value', label: 'Deal value ($)', type: 'number', required: false },
      {
        key: 'decision_timeline',
        label: 'Decision timeline',
        type: 'select',
        required: false,
        options: ['Immediate', '30 days', '60 days', 'Quarter', 'Year', 'Exploring'],
      },
      { key: 'decision_maker', label: 'Decision maker', type: 'boolean', required: false },
      { key: 'budget_confirmed', label: 'Budget confirmed', type: 'boolean', required: false },
      { key: 'pain_points', label: 'Pain points', type: 'textarea', required: false },
      {
        key: 'competitors_evaluated',
        label: 'Competitors evaluated',
        type: 'textarea',
        required: false,
      },
      {
        key: 'lead_source',
        label: 'Lead source',
        type: 'select',
        required: false,
        options: ['Website', 'Referral', 'Event', 'Outbound', 'Partner', 'Inbound call', 'Other'],
      },
      { key: 'lead_score', label: 'Lead score (0-100)', type: 'number', required: false },
    ],
    pipeline_stages: [
      { name: 'New lead', position: 1, color: C.blue, is_default: true },
      { name: 'Qualified', position: 2, color: C.blue },
      { name: 'Demo scheduled', position: 3, color: C.amber },
      { name: 'Proposal sent', position: 4, color: C.amber },
      { name: 'Negotiation', position: 5, color: C.teal },
      { name: 'Closed won', position: 6, color: C.green, is_terminal: true, is_won: true },
      { name: 'Closed lost', position: 7, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'Inbound sales qualification',
      'Demo and discovery call scheduling',
      'Pricing and package questions',
      'Renewal or expansion inquiry',
      'Partner or integration inquiry',
      'Support escalation (route to CS)',
    ],
    system_prompt_template:
      'You are Maya, a friendly AI assistant for {{business_name}}. Help callers learn about the product, book demos, and answer questions. Be warm and professional.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '9am-6pm', sat: 'closed', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thank you for calling {business}! If you'd like to schedule a demo, reply or call us anytime.",
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'Following up from {business}',
        template:
          "We wanted to follow up on your recent inquiry. We'd love to help you get started with a personalized demo.",
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          "Hi {name}, just checking in from {business}. We're here when you're ready. Reply STOP to opt out.",
      },
    ],
  },

  dental: {
    slug: 'dental',
    label: 'Dental practice',
    inventory_label: 'Clinical Supplies',
    staff_label: 'Providers & Staff',
    // NOTE: insurance_id / insurance_provider intentionally removed — those are
    // integration-layer values (eligibility check), not stored CRM fields.
    fields: [
      { key: 'date_of_birth', label: 'Date of birth', type: 'date', required: false },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date', required: false },
      { key: 'next_recall_date', label: 'Next recall date', type: 'date', required: false },
      { key: 'allergies', label: 'Allergies', type: 'textarea', required: false },
      {
        key: 'current_medications',
        label: 'Current medications',
        type: 'textarea',
        required: false,
      },
      { key: 'chief_complaint', label: 'Chief complaint', type: 'text', required: false },
      { key: 'treatment_notes', label: 'Treatment notes', type: 'textarea', required: false },
      { key: 'referral_source', label: 'Referral source', type: 'text', required: false },
      { key: 'preferred_dentist', label: 'Preferred dentist', type: 'text', required: false },
      {
        key: 'preferred_appointment_time',
        label: 'Preferred appointment time',
        type: 'select',
        required: false,
        options: ['Morning', 'Afternoon', 'Evening'],
      },
      {
        key: 'x_ray_consent_on_file',
        label: 'X-ray consent on file',
        type: 'boolean',
        required: false,
      },
      { key: 'last_cleaning_date', label: 'Last cleaning date', type: 'date', required: false },
    ],
    pipeline_stages: [
      { name: 'New inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Consultation scheduled', position: 2, color: C.blue },
      { name: 'Treatment plan presented', position: 3, color: C.amber },
      { name: 'Active patient', position: 4, color: C.green, is_won: true },
      { name: 'Recall due', position: 5, color: C.teal },
      { name: 'Inactive / lapsed', position: 6, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'New patient appointment request',
      'Reschedule or cancel existing appointment',
      'Insurance coverage and treatment pricing questions',
      'Emergency toothache triage',
      'Recall / routine cleaning reminder response',
      'Prescription refill request',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}} dental practice. Help patients book appointments, answer questions about services, and handle recalls.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '8am-5pm', sat: '9am-1pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to help you schedule a cleaning or checkup. Reply or call anytime.",
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'Your dental health matters — {business}',
        template:
          "We wanted to follow up on your recent call. Regular checkups are key to great oral health. We'd love to get you on the schedule.",
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, just a friendly reminder from {business} — we have openings this week. Reply STOP to opt out.',
      },
    ],
  },

  medical: {
    slug: 'medical',
    label: 'Medical clinic',
    inventory_label: 'Medical Supplies',
    staff_label: 'Providers & Staff',
    // NOTE: insurance_id intentionally excluded — eligibility is an integration
    // concern, not a stored CRM field.
    fields: [
      { key: 'date_of_birth', label: 'Date of birth', type: 'date', required: false },
      { key: 'primary_physician', label: 'Primary physician', type: 'text', required: false },
      { key: 'current_conditions', label: 'Current conditions', type: 'textarea', required: false },
      {
        key: 'current_medications',
        label: 'Current medications',
        type: 'textarea',
        required: false,
      },
      { key: 'allergies', label: 'Allergies', type: 'textarea', required: false },
      {
        key: 'emergency_contact_name',
        label: 'Emergency contact name',
        type: 'text',
        required: false,
      },
      {
        key: 'emergency_contact_phone',
        label: 'Emergency contact phone',
        type: 'text',
        required: false,
      },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date', required: false },
      { key: 'next_followup_date', label: 'Next follow-up date', type: 'date', required: false },
      { key: 'chief_complaint', label: 'Chief complaint', type: 'text', required: false },
      { key: 'preferred_pharmacy', label: 'Preferred pharmacy', type: 'text', required: false },
      { key: 'hipaa_acknowledged', label: 'HIPAA acknowledged', type: 'boolean', required: false },
    ],
    pipeline_stages: [
      { name: 'New patient', position: 1, color: C.blue, is_default: true },
      { name: 'Intake scheduled', position: 2, color: C.blue },
      { name: 'Consultation', position: 3, color: C.amber },
      { name: 'Active patient', position: 4, color: C.green, is_won: true },
      { name: 'Follow-up scheduled', position: 5, color: C.teal },
      { name: 'Inactive / lapsed', position: 6, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'New patient intake and registration',
      'Appointment booking and rescheduling',
      'Prescription refill request',
      'Billing and insurance questions (route to billing staff)',
      'Test results inquiry (route to nurse line)',
      'Urgent symptom triage (route to on-call)',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}} medical clinic. Help patients book appointments, handle intake, and route urgent issues to clinical staff. Never give medical advice.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '8am-5pm', sat: 'closed', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          'Hi {name}, thanks for calling {business}. Reply here or call us to schedule your visit.',
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'Follow-up from {business}',
        template:
          "We wanted to follow up on your recent call. Our front desk is happy to help you schedule when you're ready.",
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          "Hi {name}, checking in from {business}. Let us know if you'd like to book a visit. Reply STOP to opt out.",
      },
    ],
  },

  veterinary: {
    slug: 'veterinary',
    label: 'Veterinary clinic',
    inventory_label: 'Medical & Veterinary Supplies',
    staff_label: 'Veterinarians & Staff',
    fields: [
      { key: 'pet_name', label: 'Pet name', type: 'text', required: true },
      {
        key: 'species',
        label: 'Species',
        type: 'select',
        required: false,
        options: ['Dog', 'Cat', 'Rabbit', 'Bird', 'Reptile', 'Exotic', 'Other'],
      },
      { key: 'breed', label: 'Breed', type: 'text', required: false },
      { key: 'pet_date_of_birth', label: 'Pet date of birth', type: 'date', required: false },
      { key: 'weight_lbs', label: 'Weight (lbs)', type: 'number', required: false },
      { key: 'color_markings', label: 'Color / markings', type: 'text', required: false },
      { key: 'microchip_number', label: 'Microchip number', type: 'text', required: false },
      { key: 'spayed_neutered', label: 'Spayed / neutered', type: 'boolean', required: false },
      {
        key: 'vaccination_history',
        label: 'Vaccination history',
        type: 'textarea',
        required: false,
      },
      {
        key: 'current_medications',
        label: 'Current medications',
        type: 'textarea',
        required: false,
      },
      {
        key: 'allergies_conditions',
        label: 'Allergies / conditions',
        type: 'textarea',
        required: false,
      },
      { key: 'preferred_vet', label: 'Preferred vet', type: 'text', required: false },
    ],
    pipeline_stages: [
      { name: 'New inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Consultation booked', position: 2, color: C.blue },
      { name: 'Under care', position: 3, color: C.amber },
      { name: 'Recovery', position: 4, color: C.teal },
      { name: 'Annual recall', position: 5, color: C.teal },
      { name: 'Active pet', position: 6, color: C.green, is_won: true },
      { name: 'Inactive', position: 7, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'Checkup and vaccination booking',
      'Emergency and after-hours triage',
      'Boarding and grooming requests',
      'Prescription refill',
      'Surgery scheduling',
      'Annual wellness recall',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}} veterinary clinic. Help pet owners book appointments, handle wellness recalls, and route emergencies to clinical staff. Never give medical advice.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '8am-6pm', sat: '9am-2pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to get your pet on the schedule. Reply or call us.",
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'Follow-up from {business}',
        template: "Just following up on your recent call. We're here when you're ready to book.",
      },
      {
        days_after: 7,
        channel: 'sms',
        template: 'Hi {name}, checking in from {business}. Reply STOP to opt out.',
      },
    ],
  },

  salon: {
    slug: 'salon',
    label: 'Salon & spa',
    inventory_label: 'Products',
    staff_label: 'Stylists',
    fields: [
      { key: 'preferred_stylist', label: 'Preferred stylist', type: 'text', required: false },
      {
        key: 'hair_type',
        label: 'Hair type',
        type: 'select',
        required: false,
        options: ['Straight', 'Wavy', 'Curly', 'Coily'],
      },
      {
        key: 'hair_length',
        label: 'Hair length',
        type: 'select',
        required: false,
        options: ['Short', 'Medium', 'Long'],
      },
      { key: 'color_formula', label: 'Colour formula', type: 'textarea', required: false },
      { key: 'last_service_date', label: 'Last service date', type: 'date', required: false },
      { key: 'last_service_type', label: 'Last service type', type: 'text', required: false },
      {
        key: 'preferred_service_time',
        label: 'Preferred service time',
        type: 'select',
        required: false,
        options: ['Morning', 'Afternoon', 'Evening', 'Weekend'],
      },
      { key: 'birthday', label: 'Birthday', type: 'date', required: false },
      {
        key: 'product_preferences',
        label: 'Product preferences',
        type: 'textarea',
        required: false,
      },
      {
        key: 'allergies_sensitivities',
        label: 'Allergies / sensitivities',
        type: 'text',
        required: false,
      },
      {
        key: 'loyalty_tier',
        label: 'Loyalty tier',
        type: 'select',
        required: false,
        options: ['New', 'Regular', 'VIP'],
      },
      { key: 'referral_source', label: 'Referral source', type: 'text', required: false },
    ],
    pipeline_stages: [
      { name: 'New inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Consultation', position: 2, color: C.blue },
      { name: 'Service booked', position: 3, color: C.amber },
      { name: 'Regular client', position: 4, color: C.green, is_won: true },
      { name: 'At risk', position: 5, color: C.amber },
      { name: 'Lapsed', position: 6, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'Color, cut, and treatment booking',
      'Reschedule or cancel',
      'Service pricing and stylist availability',
      'Product availability',
      'Gift card purchases',
      'Last-minute cancellation fill',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}. Help clients book hair and beauty appointments, check availability, and answer service questions.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '9am-7pm', sat: '9am-5pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to get you booked for your next visit. Reply or call anytime.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Time for a refresh? — {business}',
        template:
          'We wanted to follow up from your recent inquiry. We have great availability this week and would love to see you.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, openings available this week at {business}. Book your spot! Reply STOP to opt out.',
      },
    ],
  },

  restaurant: {
    slug: 'restaurant',
    label: 'Restaurant',
    inventory_label: 'Ingredients & Stock',
    staff_label: 'Staff',
    // NOTE: dietary_restrictions + favorite_occasions modelled as freeform text
    // pending multiselect renderer support (current UI only handles single select).
    fields: [
      { key: 'party_size_typical', label: 'Usual party size', type: 'number', required: false },
      {
        key: 'seating_preference',
        label: 'Seating preference',
        type: 'select',
        required: false,
        options: ['Indoor', 'Outdoor', 'Bar', 'Private Room', 'No preference'],
      },
      {
        key: 'dietary_restrictions',
        label: 'Dietary restrictions (comma separated)',
        type: 'textarea',
        required: false,
      },
      {
        key: 'favorite_occasions',
        label: 'Favorite occasions (comma separated)',
        type: 'textarea',
        required: false,
      },
      { key: 'preferred_server', label: 'Preferred server', type: 'text', required: false },
      { key: 'favorite_dishes', label: 'Favorite dishes', type: 'textarea', required: false },
      { key: 'wine_preferences', label: 'Wine preferences', type: 'textarea', required: false },
      {
        key: 'loyalty_tier',
        label: 'Loyalty tier',
        type: 'select',
        required: false,
        options: ['New', 'Regular', 'VIP'],
      },
      { key: 'special_notes', label: 'Special notes', type: 'textarea', required: false },
      { key: 'marketing_opt_in', label: 'Marketing opt-in', type: 'boolean', required: false },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date', required: false },
      {
        key: 'reservation_count_ytd',
        label: 'Reservations YTD',
        type: 'number',
        required: false,
      },
    ],
    pipeline_stages: [
      { name: 'Inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Reservation confirmed', position: 2, color: C.blue },
      { name: 'Arrived', position: 3, color: C.amber },
      { name: 'Past guest', position: 4, color: C.teal },
      { name: 'VIP regular', position: 5, color: C.green, is_won: true },
      { name: 'No-show', position: 6, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'Table reservation (any party size)',
      'Large-party or private event inquiry',
      'Hours, menu, dietary questions',
      'Reservation change or cancellation',
      'Gift card or voucher inquiry',
      'Event / catering inquiry (route to owner)',
    ],
    system_prompt_template:
      'You are Maya, the AI host for {{business_name}}. Help guests make reservations, answer questions about the menu and hours, and handle special requests.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '11am-10pm', sat: '11am-11pm', sun: '11am-9pm' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for reaching out to {business}! We'd love to host you. Call or reply to make a reservation.",
      },
      {
        days_after: 5,
        channel: 'email',
        subject: 'Join us at {business}',
        template:
          'We wanted to follow up on your recent inquiry. We have great specials this week and would love to welcome you.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, hope to see you at {business} soon! Check out our latest menu. Reply STOP to opt out.',
      },
    ],
  },

  contractor: {
    slug: 'contractor',
    label: 'Contractor',
    inventory_label: 'Materials',
    staff_label: 'Crew',
    fields: [
      {
        key: 'project_type',
        label: 'Project type',
        type: 'select',
        required: false,
        options: ['Remodel', 'New build', 'Repair', 'Maintenance', 'Inspection', 'Other'],
      },
      { key: 'scope_of_work', label: 'Scope of work', type: 'textarea', required: false },
      { key: 'property_address', label: 'Property address', type: 'text', required: false },
      {
        key: 'property_type',
        label: 'Property type',
        type: 'select',
        required: false,
        options: ['Residential', 'Commercial', 'Multifamily', 'Other'],
      },
      {
        key: 'budget_range',
        label: 'Budget range',
        type: 'select',
        required: false,
        options: ['Under 5k', '5-15k', '15-50k', '50-150k', '150k+'],
      },
      {
        key: 'timeline_urgency',
        label: 'Timeline / urgency',
        type: 'select',
        required: false,
        options: ['Emergency', 'This month', '1-3 months', '3-6 months', 'Flexible'],
      },
      {
        key: 'insurance_claim_involved',
        label: 'Insurance claim involved',
        type: 'boolean',
        required: false,
      },
      { key: 'permit_required', label: 'Permit required', type: 'boolean', required: false },
      { key: 'warranty_months', label: 'Warranty (months)', type: 'number', required: false },
      { key: 'bid_amount', label: 'Bid amount ($)', type: 'number', required: false },
      {
        key: 'bid_status',
        label: 'Bid status',
        type: 'select',
        required: false,
        options: ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'],
      },
      { key: 'referral_source', label: 'Referral source', type: 'text', required: false },
    ],
    pipeline_stages: [
      { name: 'New lead', position: 1, color: C.blue, is_default: true },
      { name: 'Site visit scheduled', position: 2, color: C.blue },
      { name: 'Estimate sent', position: 3, color: C.amber },
      { name: 'Accepted', position: 4, color: C.green },
      { name: 'In progress', position: 5, color: C.teal },
      { name: 'Completed', position: 6, color: C.green, is_terminal: true, is_won: true },
      { name: 'Lost', position: 7, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'New project or estimate inquiry',
      'Site visit scheduling',
      'Project status and timeline questions',
      'Warranty or punch-list items',
      'Invoice or payment questions',
      'Referral from another customer',
    ],
    system_prompt_template:
      'You are Maya, the scheduling assistant for {{business_name}}. Help customers book estimates, follow up on jobs, and answer service questions.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '7am-5pm', sat: '8am-12pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! If you'd like to discuss your project, reply or call us anytime.",
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'Your project estimate — {business}',
        template:
          "We wanted to follow up on your recent inquiry. We'd love to schedule a time to come out and provide a free estimate.",
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, just checking in from {business}. Ready to get your project started? Reply STOP to opt out.',
      },
    ],
  },

  law_firm: {
    slug: 'law_firm',
    label: 'Law firm',
    inventory_label: 'Office Supplies',
    staff_label: 'Attorneys & Staff',
    fields: [
      {
        key: 'case_type',
        label: 'Case type',
        type: 'select',
        required: false,
        options: [
          'Family',
          'Estate',
          'Personal injury',
          'Criminal',
          'Real estate',
          'Corporate',
          'Immigration',
          'IP',
          'Other',
        ],
      },
      { key: 'matter_number', label: 'Matter number', type: 'text', required: false },
      {
        key: 'conflict_check_status',
        label: 'Conflict check status',
        type: 'select',
        required: false,
        options: ['Pending', 'Cleared', 'Conflict', 'Waived'],
      },
      { key: 'opposing_party', label: 'Opposing party', type: 'text', required: false },
      {
        key: 'statute_of_limitations_date',
        label: 'Statute of limitations date',
        type: 'date',
        required: false,
      },
      {
        key: 'retainer_status',
        label: 'Retainer status',
        type: 'select',
        required: false,
        options: ['Not Paid', 'Partial', 'Paid', 'Depleted'],
      },
      { key: 'retainer_amount', label: 'Retainer amount ($)', type: 'number', required: false },
      {
        key: 'hourly_rate_agreed',
        label: 'Hourly rate agreed ($)',
        type: 'number',
        required: false,
      },
      { key: 'court_jurisdiction', label: 'Court jurisdiction', type: 'text', required: false },
      { key: 'case_description', label: 'Case description', type: 'textarea', required: false },
      { key: 'referred_by', label: 'Referred by', type: 'text', required: false },
      { key: 'privileged_notes', label: 'Privileged notes', type: 'textarea', required: false },
    ],
    pipeline_stages: [
      { name: 'New inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Conflict check', position: 2, color: C.blue },
      { name: 'Consultation scheduled', position: 3, color: C.amber },
      { name: 'Consultation complete', position: 4, color: C.amber },
      { name: 'Retained', position: 5, color: C.green },
      { name: 'Active matter', position: 6, color: C.teal, is_won: true },
      { name: 'Closed / declined', position: 7, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'New client intake and case screening',
      'Consultation scheduling',
      'Case status and document questions',
      'Retainer or billing questions',
      'Referral intake',
      'Urgent matter (route to attorney directly)',
    ],
    system_prompt_template:
      'You are Maya, the intake assistant for {{business_name}} law firm. Help potential clients schedule consultations and answer general questions. Never give legal advice.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '9am-5pm', sat: 'closed', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for reaching out to {business}. If you'd like to schedule a consultation, reply or call us.",
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'Your consultation with {business}',
        template:
          'We wanted to follow up on your recent inquiry. We offer free initial consultations and would be happy to discuss your situation.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          "Hi {name}, just following up from {business}. We're here when you're ready to talk. Reply STOP to opt out.",
      },
    ],
  },

  real_estate: {
    slug: 'real_estate',
    label: 'Real estate',
    inventory_label: 'Marketing Materials',
    staff_label: 'Agents',
    // NOTE: property_types modelled as freeform text pending multiselect
    // renderer support (current UI only handles single select).
    fields: [
      {
        key: 'client_type',
        label: 'Client type',
        type: 'select',
        required: false,
        options: ['Buyer', 'Seller', 'Both', 'Investor', 'Renter'],
      },
      { key: 'budget_min', label: 'Budget min ($)', type: 'number', required: false },
      { key: 'budget_max', label: 'Budget max ($)', type: 'number', required: false },
      { key: 'preferred_areas', label: 'Preferred areas', type: 'textarea', required: false },
      { key: 'bedrooms_min', label: 'Bedrooms (min)', type: 'number', required: false },
      { key: 'bathrooms_min', label: 'Bathrooms (min)', type: 'number', required: false },
      {
        key: 'property_types',
        label: 'Property types (comma separated)',
        type: 'textarea',
        required: false,
      },
      {
        key: 'timeline',
        label: 'Timeline',
        type: 'select',
        required: false,
        options: ['0-30 days', '30-90 days', '3-6 months', '6-12 months', 'Flexible'],
      },
      {
        key: 'pre_approval_status',
        label: 'Pre-approval status',
        type: 'select',
        required: false,
        options: ['Not started', 'In progress', 'Approved', 'Cash buyer'],
      },
      {
        key: 'financing_type',
        label: 'Financing type',
        type: 'select',
        required: false,
        options: ['Conventional', 'FHA', 'VA', 'Cash', 'Other'],
      },
      { key: 'first_time_buyer', label: 'First-time buyer', type: 'boolean', required: false },
      { key: 'referral_source', label: 'Referral source', type: 'text', required: false },
    ],
    pipeline_stages: [
      { name: 'New lead', position: 1, color: C.blue, is_default: true },
      { name: 'Showing scheduled', position: 2, color: C.blue },
      { name: 'Actively touring', position: 3, color: C.amber },
      { name: 'Offer made', position: 4, color: C.amber },
      { name: 'Under contract', position: 5, color: C.teal },
      { name: 'Closed won', position: 6, color: C.green, is_terminal: true, is_won: true },
      { name: 'Closed lost', position: 7, color: C.gray, is_terminal: true, is_lost: true },
    ],
    maya_intents: [
      'Listing and showing inquiries',
      'Pre-qualification or buyer questions',
      'Open house RSVPs',
      'Offer and negotiation updates',
      'Closing coordination',
      'New seller listing inquiry',
    ],
    system_prompt_template:
      'You are Maya, the assistant for {{business_name}} real estate. Help clients schedule property viewings, answer listing questions, and connect with agents.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '9am-6pm', sat: '10am-4pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to help you find the perfect property. Reply or call anytime.",
      },
      {
        days_after: 3,
        channel: 'email',
        subject: 'New listings for you — {business}',
        template:
          "We wanted to follow up on your recent inquiry. We have some great properties that might interest you. Let us know when you'd like to schedule a viewing.",
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, new listings just dropped at {business}. Ready to schedule a showing? Reply STOP to opt out.',
      },
    ],
  },
}

export const VERTICAL_SLUGS = Object.keys(VERTICALS) as (keyof typeof VERTICALS)[]

export function getVertical(slug: string): VerticalConfig {
  const config = VERTICALS[slug]
  if (!config) throw new Error(`Unknown vertical: ${slug}`)
  return config
}
