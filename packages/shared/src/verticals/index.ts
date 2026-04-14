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
  fields: VerticalField[]
  pipeline_stages: PipelineStageConfig[]
  system_prompt_template: string
  business_hours: BusinessHours
  follow_up_cadence: FollowUpStep[]
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
      'You are Maya, a friendly AI assistant for {{business_name}}. Help callers learn about the product, book demos, and answer questions. Be warm and professional. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
      'You are Maya, the AI receptionist for {{business_name}} dental practice. Help patients book appointments, answer questions about services, and handle recalls. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
      'You are Maya, the AI receptionist for {{business_name}}. Help clients book hair and beauty appointments, check availability, and answer service questions. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
      'You are Maya, the AI host for {{business_name}}. Help guests make reservations, answer questions about the menu and hours, and handle special requests. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
      'You are Maya, the scheduling assistant for {{business_name}}. Help customers book estimates, follow up on jobs, and answer service questions. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
      'You are Maya, the intake assistant for {{business_name}} law firm. Help potential clients schedule consultations and answer general questions. Never give legal advice. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
      'You are Maya, the assistant for {{business_name}} real estate. Help clients schedule property viewings, answer listing questions, and connect with agents. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person. When the caller says goodbye or ends the conversation, say a warm closing line and then end the call. Do not wait for the caller to hang up.',
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
