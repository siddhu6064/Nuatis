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
  compliance_tier?: string
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

  gym: {
    slug: 'gym',
    label: 'Gym & Fitness Studio',
    inventory_label: 'Equipment / Supps',
    staff_label: 'Trainers / Coaches',
    fields: [
      {
        key: 'fitness_goal',
        label: 'Fitness goal',
        type: 'select',
        required: false,
        options: ['Weight Loss', 'Muscle Gain', 'Endurance', 'Flexibility', 'General Fitness'],
      },
      {
        key: 'membership_type',
        label: 'Membership type',
        type: 'select',
        required: false,
        options: ['Monthly', 'Annual', 'Drop-In', 'Class Pack'],
      },
      { key: 'preferred_trainer', label: 'Preferred trainer', type: 'text', required: false },
      {
        key: 'medical_clearance',
        label: 'Medical clearance',
        type: 'select',
        required: false,
        options: ['Yes', 'No', 'Pending'],
      },
      { key: 'emergency_contact', label: 'Emergency contact', type: 'text', required: false },
      { key: 'join_date', label: 'Join date', type: 'date', required: false },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date', required: false },
    ],
    pipeline_stages: [
      { name: 'Lead', position: 1, color: '#3B82F6', is_default: true },
      { name: 'Trial Session', position: 2, color: '#F59E0B' },
      { name: 'Active Member', position: 3, color: '#22C55E' },
      { name: 'At-Risk Member', position: 4, color: '#EF4444' },
      { name: 'Lapsed', position: 5, color: '#6B7280', is_terminal: true },
    ],
    maya_intents: [
      'Personal training session booking',
      'Group fitness class booking',
      'Membership inquiry',
      'Trial session or free class request',
      'Class schedule questions',
      'Cancellation policy',
    ],
    system_prompt_template:
      "You are Maya, the AI receptionist for {{business_name}}, a gym and fitness studio. Speak in an energetic, motivating, and friendly tone. You help callers book personal training sessions and fitness classes, answer questions about memberships, and get people excited about their fitness journey. You know the gym's full service menu including personal training, group fitness classes, yoga, pilates, nutrition consultations, and sports massage. Always encourage callers to book a trial session or free class if they are new. Never provide specific medical or dietary advice beyond general fitness guidance." +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '5am-10pm', sat: '7am-8pm', sun: '7am-8pm' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          'Hi {name}, thanks for reaching out to {business}! Ready to crush your fitness goals? Book your first session today. Reply STOP to opt out.',
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Your fitness journey starts at {business}',
        template:
          'We wanted to follow up on your recent inquiry. We have classes and training sessions available and would love to help you reach your goals.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, spots still available at {business} this week. Book your trial session today! Reply STOP to opt out.',
      },
    ],
  },

  laundry: {
    slug: 'laundry',
    label: 'Laundry & Dry Cleaning',
    inventory_label: 'Laundry Supplies',
    staff_label: 'Staff & Pressers',
    compliance_tier: 'tcpa',
    fields: [
      {
        key: 'preferred_service',
        label: 'Preferred service',
        type: 'select',
        required: false,
        options: ['Wash & Fold', 'Dry Cleaning', 'Shirt Press', 'Specialty'],
      },
      { key: 'membership_active', label: 'Membership active', type: 'boolean', required: false },
      { key: 'last_order_date', label: 'Last order date', type: 'date', required: false },
      {
        key: 'preferred_contact_time',
        label: 'Preferred contact time',
        type: 'select',
        required: false,
        options: ['Morning', 'Afternoon', 'Evening'],
      },
      {
        key: 'special_instructions',
        label: 'Special instructions',
        type: 'textarea',
        required: false,
      },
    ],
    pipeline_stages: [
      { name: 'Lead', position: 1, color: C.blue, is_default: true },
      { name: 'First Order', position: 2, color: C.amber },
      { name: 'Regular', position: 3, color: C.teal },
      { name: 'Member', position: 4, color: C.green, is_won: true },
    ],
    maya_intents: [
      'Drop-off laundry scheduling',
      'Dry cleaning inquiry',
      'Rush same-day service request',
      'Pickup and delivery availability',
      'Membership and pricing questions',
      'Order status and ready-for-pickup',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}, a laundry and dry cleaning service. Speak in a helpful, efficient, and detail-oriented tone. Opening: "Thanks for calling {{business_name}}! This is Maya. I can help with drop-off laundry, dry cleaning, or scheduling a pickup — what can I do for you today?" You know turnaround times and pricing for all services. Rush same-day service is available for an additional fee. When callers ask about pricing, mention that monthly membership plans are available for discounted rates. When a caller books a pickup by phone, note that verbal consent to receive text message reminders has been granted per TCPA guidelines.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '7am-7pm', sat: '8am-5pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to handle your laundry or dry cleaning. Reply or call us anytime. Reply STOP to opt out.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Fresh clothes, fast — {business}',
        template:
          'We wanted to follow up on your recent inquiry. We offer same-day rush service and monthly membership plans for regular customers.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, ready for a fresh batch? Drop off anytime at {business}. Reply STOP to opt out.',
      },
    ],
  },

  car_wash: {
    slug: 'car_wash',
    label: 'Car Wash',
    inventory_label: 'Wash Supplies',
    staff_label: 'Detailers',
    compliance_tier: 'tcpa',
    fields: [
      {
        key: 'vehicle_type',
        label: 'Vehicle type',
        type: 'select',
        required: false,
        options: ['Sedan', 'SUV', 'Truck', 'Van', 'Sports', 'Other'],
      },
      { key: 'preferred_package', label: 'Preferred package', type: 'text', required: false },
      { key: 'membership_active', label: 'Membership active', type: 'boolean', required: false },
      { key: 'last_wash_date', label: 'Last wash date', type: 'date', required: false },
      { key: 'license_plate', label: 'License plate', type: 'text', required: false },
    ],
    pipeline_stages: [
      { name: 'Lead', position: 1, color: C.blue, is_default: true },
      { name: 'First Wash', position: 2, color: C.amber },
      { name: 'Regular', position: 3, color: C.teal },
      { name: 'Club Member', position: 4, color: C.green, is_won: true },
    ],
    maya_intents: [
      'Wash package booking',
      'Full detail appointment scheduling',
      'Membership and wash club questions',
      'Walk-in availability',
      'Pricing questions',
      'Appointment reschedule or cancel',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}, a car wash and detailing service. Speak in an efficient, friendly, and quick-service tone. Opening: "Thanks for calling {{business_name}}! This is Maya. I can help you schedule a wash or detail — what can I do for you?" You know the full service menu including Basic, Deluxe, and Premium washes, interior detail, full detail packages, hand wax, tire and rim cleaning, and engine bay cleaning. For full detail packages, mention it takes 2 to 4 hours and an appointment is recommended. When callers ask about pricing, always mention that wash club memberships are available for unlimited washes at a fixed monthly rate. When a caller books an appointment by phone, note that verbal consent to receive text message reminders has been granted per TCPA guidelines.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '7am-7pm', sat: '7am-6pm', sun: '8am-5pm' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to get your vehicle sparkling. Reply or call to book your wash or detail. Reply STOP to opt out.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Keep your ride looking sharp — {business}',
        template:
          'We wanted to follow up on your recent inquiry. We have great availability this week for washes and detail packages.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, openings available this week at {business}. Book your wash or detail today! Reply STOP to opt out.',
      },
    ],
  },

  tattoo: {
    slug: 'tattoo',
    label: 'Tattoo Studio',
    inventory_label: 'Inks & Supplies',
    staff_label: 'Artists',
    compliance_tier: 'tcpa',
    fields: [
      {
        key: 'style_preference',
        label: 'Style preference',
        type: 'select',
        required: false,
        options: [
          'Traditional',
          'Neo-Traditional',
          'Blackwork',
          'Realism',
          'Watercolor',
          'Minimalist',
          'Other',
        ],
      },
      { key: 'preferred_artist', label: 'Preferred artist', type: 'text', required: false },
      { key: 'placement', label: 'Placement / body area', type: 'text', required: false },
      {
        key: 'has_reference_image',
        label: 'Has reference image',
        type: 'boolean',
        required: false,
      },
      { key: 'deposit_paid', label: 'Deposit paid', type: 'boolean', required: false },
      { key: 'consultation_date', label: 'Consultation date', type: 'date', required: false },
      { key: 'session_date', label: 'Session date', type: 'date', required: false },
      { key: 'is_cover_up', label: 'Cover-up', type: 'boolean', required: false },
    ],
    pipeline_stages: [
      { name: 'Inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Consultation', position: 2, color: C.amber },
      { name: 'Deposit Paid', position: 3, color: C.teal },
      { name: 'Session Booked', position: 4, color: C.teal },
      { name: 'Completed', position: 5, color: C.green, is_won: true },
    ],
    maya_intents: [
      'Tattoo consultation booking',
      'Flash tattoo and walk-in availability',
      'Cover-up inquiry',
      'Piercing booking',
      'Deposit and appointment questions',
      'Aftercare questions',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}, a tattoo studio. Speak in a creative, professional, and consultation-focused tone. Opening: "Thanks for calling {{business_name}}! This is Maya. Whether you have an idea in mind or need some inspiration, I\'m here to help." Never quote specific pricing — if a caller asks about cost, say "Pricing depends on the size, complexity, and artist — I can book you a free consultation to get an exact quote." Do not discuss artist licensing. When booking any tattoo session, always mention that a deposit is required to secure the appointment.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '11am-8pm', sat: '10am-7pm', sun: '12pm-6pm' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for reaching out to {business}! We'd love to help bring your tattoo idea to life. Reply or call to book a free consultation. Reply STOP to opt out.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Your tattoo journey starts at {business}',
        template:
          'We wanted to follow up on your recent inquiry. Our artists offer free consultations to walk through your idea and provide an accurate quote.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, consultation slots available this week at {business}. Book yours today! Reply STOP to opt out.',
      },
    ],
  },

  pet_grooming: {
    slug: 'pet_grooming',
    label: 'Pet Grooming',
    inventory_label: 'Grooming Supplies',
    staff_label: 'Groomers',
    compliance_tier: 'tcpa',
    fields: [
      { key: 'pet_name', label: 'Pet name', type: 'text', required: false },
      {
        key: 'species',
        label: 'Species',
        type: 'select',
        required: false,
        options: ['Dog', 'Cat', 'Other'],
      },
      { key: 'breed', label: 'Breed', type: 'text', required: false },
      { key: 'preferred_groomer', label: 'Preferred groomer', type: 'text', required: false },
      { key: 'last_groom_date', label: 'Last groom date', type: 'date', required: false },
      {
        key: 'coat_type',
        label: 'Coat type',
        type: 'select',
        required: false,
        options: ['Short', 'Medium', 'Long', 'Double', 'Wire', 'Curly'],
      },
      {
        key: 'allergies_sensitivities',
        label: 'Allergies / sensitivities',
        type: 'text',
        required: false,
      },
      {
        key: 'vaccination_current',
        label: 'Vaccinations current',
        type: 'boolean',
        required: false,
      },
    ],
    pipeline_stages: [
      { name: 'New Client', position: 1, color: C.blue, is_default: true },
      { name: 'First Appointment', position: 2, color: C.amber },
      { name: 'Regular', position: 3, color: C.teal },
      { name: 'Member', position: 4, color: C.green, is_won: true },
    ],
    maya_intents: [
      'Grooming appointment booking',
      'Breed-specific cut questions',
      'First-visit preparation questions',
      'Cat grooming inquiry',
      'Appointment reschedule or cancel',
      'Membership and loyalty questions',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}, a pet grooming salon. Speak in a warm, nurturing, and pet-loving tone. Opening: "Hi, thank you for calling {{business_name}}! This is Maya. How can I help you and your furry friend today?" You know the full grooming service menu including baths, full grooms, nail trims, ear cleaning, teeth brushing, de-shedding treatments, and specialty services for puppies and cats. Always be reassuring about the safety and comfort of pets. If a caller asks about sedation, say "We never use sedation — our groomers are trained in gentle handling techniques to keep your pet calm and comfortable throughout the visit." When a caller books an appointment by phone, note that verbal consent to receive text message reminders has been granted per TCPA guidelines.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '8am-6pm', sat: '8am-5pm', sun: 'closed' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to get your pet booked for a grooming appointment. Reply or call us anytime. Reply STOP to opt out.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Your pet deserves the best — {business}',
        template:
          'We wanted to follow up on your recent inquiry. Our groomers would love to pamper your furry friend!',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          "Hi {name}, openings available this week at {business}. Book your pet's grooming appointment today! Reply STOP to opt out.",
      },
    ],
  },

  nail_bar: {
    slug: 'nail_bar',
    label: 'Nail Bar',
    inventory_label: 'Polish & Supplies',
    staff_label: 'Nail Techs',
    compliance_tier: 'tcpa',
    fields: [
      { key: 'preferred_tech', label: 'Preferred nail tech', type: 'text', required: false },
      {
        key: 'nail_type',
        label: 'Nail type preference',
        type: 'select',
        required: false,
        options: ['Natural', 'Gel', 'Acrylic', 'Dip Powder', 'No preference'],
      },
      { key: 'last_service_date', label: 'Last service date', type: 'date', required: false },
      { key: 'last_service_type', label: 'Last service type', type: 'text', required: false },
      {
        key: 'allergies_sensitivities',
        label: 'Allergies / sensitivities',
        type: 'text',
        required: false,
      },
      {
        key: 'preferred_appointment_time',
        label: 'Preferred appointment time',
        type: 'select',
        required: false,
        options: ['Morning', 'Afternoon', 'Evening', 'Weekend'],
      },
      { key: 'birthday', label: 'Birthday', type: 'date', required: false },
      {
        key: 'loyalty_tier',
        label: 'Loyalty tier',
        type: 'select',
        required: false,
        options: ['New Client', 'Regular', 'Loyal Member'],
      },
    ],
    pipeline_stages: [
      { name: 'New Client', position: 1, color: C.blue, is_default: true },
      { name: 'First Appointment', position: 2, color: C.amber },
      { name: 'Regular', position: 3, color: C.teal },
      { name: 'Loyal Member', position: 4, color: C.green, is_won: true },
    ],
    maya_intents: [
      'Manicure and pedicure booking',
      'Gel, acrylic, and dip powder service questions',
      'Nail art inquiry',
      'Walk-in availability',
      'Appointment reschedule or cancel',
      'Loyalty membership questions',
    ],
    system_prompt_template:
      'You are Maya, the AI receptionist for {{business_name}}, a nail bar. Speak in a friendly, bubbly, and detail-oriented tone. Opening: "Hi, thank you for calling {{business_name}}! This is Maya. What can I help you with today?" You know the full service menu including gel, acrylic, and dip powder manicures and pedicures. Always mention that walk-ins are welcome but appointments are preferred. If a caller asks about nail art pricing for multiple nails or complex designs, say "Pricing depends on the design — I\'d recommend booking a consultation so your nail tech can give you an exact quote." When a caller books an appointment by phone, note that verbal consent to receive text message reminders has been granted per TCPA guidelines.' +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '10am-7pm', sat: '9am-6pm', sun: '11am-5pm' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thanks for calling {business}! We'd love to get you booked for your next nail appointment. Reply or call us anytime. Reply STOP to opt out.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Treat yourself — {business}',
        template:
          'We wanted to follow up on your recent inquiry. We have great availability this week and would love to take care of your nails!',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, openings available this week at {business}. Book your nail appointment today! Reply STOP to opt out.',
      },
    ],
  },

  spa: {
    slug: 'spa',
    label: 'Spa & Wellness',
    inventory_label: 'Oils & Supplies',
    staff_label: 'Therapists',
    fields: [
      {
        key: 'skin_type',
        label: 'Skin type',
        type: 'select',
        required: false,
        options: ['Normal', 'Oily', 'Dry', 'Combination', 'Sensitive'],
      },
      { key: 'preferred_therapist', label: 'Preferred therapist', type: 'text', required: false },
      { key: 'member_since', label: 'Member since', type: 'date', required: false },
      {
        key: 'allergies_sensitivities',
        label: 'Allergies / sensitivities',
        type: 'text',
        required: false,
      },
      {
        key: 'preferred_pressure',
        label: 'Preferred pressure',
        type: 'select',
        required: false,
        options: ['Light', 'Medium', 'Firm', 'Deep'],
      },
      {
        key: 'preferred_appointment_time',
        label: 'Preferred appointment time',
        type: 'select',
        required: false,
        options: ['Morning', 'Afternoon', 'Evening', 'Weekend'],
      },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date', required: false },
      { key: 'special_requests', label: 'Special requests', type: 'textarea', required: false },
    ],
    pipeline_stages: [
      { name: 'Inquiry', position: 1, color: C.blue, is_default: true },
      { name: 'Consultation Booked', position: 2, color: C.blue },
      { name: 'First Visit', position: 3, color: C.amber },
      { name: 'Returning Client', position: 4, color: C.teal },
      { name: 'Member', position: 5, color: C.green, is_won: true },
    ],
    maya_intents: [
      'Massage and spa service booking',
      'Reschedule or cancel appointment',
      'Service menu and pricing questions',
      'Gift card inquiries',
      'Membership and package questions',
      'Special occasion or couples booking',
    ],
    system_prompt_template:
      "You are Maya, the AI receptionist for {{business_name}}, a spa and wellness center. Speak in a calm, soothing, wellness-focused tone. You help callers book massage and spa services, answer questions about treatments, and provide a relaxing first impression of the business. You know the spa's full service menu including Swedish massage, deep tissue, hot stone, facials, body wraps, and couples massages. Always mention that appointments are recommended. If asked about pricing, provide the listed price for each service. For gift cards or memberships, let the caller know to ask a staff member for details. Never diagnose health conditions or give medical advice." +
      MAYA_PROMPT_SUFFIX,
    business_hours: { mon_fri: '9am-8pm', sat: '9am-8pm', sun: '10am-6pm' },
    follow_up_cadence: [
      {
        days_after: 1,
        channel: 'sms',
        template:
          "Hi {name}, thank you for calling {business}! We'd love to help you relax and unwind. Reply to book your appointment or STOP to opt out.",
      },
      {
        days_after: 4,
        channel: 'email',
        subject: 'Treat yourself — {business}',
        template:
          'We wanted to follow up on your recent inquiry. We have some wonderful services available and would love to welcome you in for some well-deserved relaxation.',
      },
      {
        days_after: 7,
        channel: 'sms',
        template:
          'Hi {name}, openings available this week at {business}. Book your treatment today! Reply STOP to opt out.',
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
