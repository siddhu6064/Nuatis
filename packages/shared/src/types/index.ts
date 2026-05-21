// =============================================================
//  Nuatis — Shared TypeScript Types
//  These mirror the PostgreSQL schema in nuatis-schema.sql
//  Import in api and web: import { Tenant, Contact } from '@nuatis/shared'
// =============================================================

// ── Enums (mirror PostgreSQL enums) ─────────────────────────

export type VerticalType =
  | 'dental'
  | 'medical'
  | 'veterinary'
  | 'salon'
  | 'restaurant'
  | 'contractor'
  | 'law_firm'
  | 'real_estate'
  | 'sales_crm'
  | 'spa'
  | 'gym'
  | 'nail_bar'
  | 'pet_grooming'
  | 'tattoo'
  | 'car_wash'
  | 'laundry'

export type SubscriptionPlan = 'starter' | 'growth' | 'pro'

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

export type UserRole = 'owner' | 'admin' | 'staff'

export type ContactSource =
  | 'inbound_call'
  | 'web_form'
  | 'manual'
  | 'import'
  | 'referral'
  | 'outbound_call'

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'rescheduled'

export type CallDirection = 'inbound' | 'outbound'

export type CallStatus = 'ringing' | 'active' | 'completed' | 'missed' | 'failed' | 'voicemail'

export type AutomationType =
  | 'appointment_reminder'
  | 'followup_sequence'
  | 'no_show_recovery'
  | 'review_request'
  | 'missed_call_sms'
  | 'recall_reminder'

// ── Core entities ────────────────────────────────────────────

export interface Tenant {
  id: string
  name: string
  slug: string
  vertical: VerticalType
  stripeCustomerId: string | null
  subscriptionPlan: SubscriptionPlan
  subscriptionStatus: SubscriptionStatus
  timezone: string
  logoUrl: string | null
  brandColor: string
  voiceId: string | null
  aiPersonaName: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Location {
  id: string
  tenantId: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string
  phoneDisplay: string | null
  telnyxNumber: string | null
  googleCalendarId: string | null
  isPrimary: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  tenantId: string
  locationId: string | null
  email: string
  fullName: string
  role: UserRole
  avatarUrl: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ── Vertical-specific contact data ───────────────────────────

export interface DentalVerticalData {
  dateOfBirth?: string
  insuranceProvider?: string
  insurancePlanId?: string
  insuranceGroupNumber?: string
  lastCleaningDate?: string
  recallIntervalMonths?: number
  preferredDentist?: string
  preferredHygienist?: string
  treatmentPlanStatus?: 'active' | 'completed' | 'pending'
  treatmentPlanNotes?: string
  overdueTreatments?: string[]
  allergies?: string[]
  hipaaConsentDate?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
}

export interface ContractorVerticalData {
  propertyAddress?: string
  propertyType?: 'residential' | 'commercial'
  lastJobType?: string
  lastJobDate?: string
  lastJobAmountCents?: number
  estimateStatus?: 'sent' | 'accepted' | 'expired' | 'rejected'
  estimateAmountCents?: number
  estimateSentDate?: string
  warrantyExpiryDate?: string
  preferredContactTime?: 'morning' | 'afternoon' | 'evening' | 'anytime'
  referralSource?: string
  seasonalReminderMonths?: number[]
  permitNotes?: string
  insuranceVerified?: boolean
}

export interface SalonVerticalData {
  preferredStylist?: string
  lastService?: string
  lastServiceDate?: string
  colorFormula?: {
    developer?: string
    brand?: string
    base?: string
    highlights?: string
  }
  hairType?: 'fine' | 'medium' | 'coarse' | 'curly' | 'wavy'
  scalpType?: 'normal' | 'oily' | 'dry' | 'sensitive'
  productAllergies?: string[]
  rebookingIntervalWeeks?: number
  loyaltyPoints?: number
  birthday?: string
  stylistNotes?: string
}

export interface LawFirmVerticalData {
  matterNumber?: string
  caseType?:
    | 'family'
    | 'criminal_defense'
    | 'personal_injury'
    | 'corporate'
    | 'real_estate'
    | 'immigration'
    | 'other'
  assignedAttorney?: string
  paralegal?: string
  retainerStatus?: 'active' | 'depleted' | 'unpaid'
  retainerBalanceCents?: number
  hourlyRateCents?: number
  nextCourtDate?: string
  nextDeadline?: string
  jurisdiction?: string
  opposingCounsel?: string
  caseStatus?: 'active' | 'closed' | 'pending' | 'settled'
  conflictCheckStatus?: 'cleared' | 'pending' | 'conflict'
  conflictCheckedAt?: string
  intakeSource?: string
  referredBy?: string
}

export interface RestaurantVerticalData {
  partySizePreference?: number
  seatingPreference?: string
  dietaryRestrictions?: string[]
  favouriteDishes?: string[]
  favouriteWine?: string
  visitFrequency?: 'weekly' | 'monthly' | 'occasional'
  lastVisitDate?: string
  lifetimeVisitCount?: number
  birthday?: string
  anniversary?: string
  specialOccasions?: string[]
  noShowCount?: number
  vipStatus?: boolean
}

export type VerticalData =
  | DentalVerticalData
  | ContractorVerticalData
  | SalonVerticalData
  | LawFirmVerticalData
  | RestaurantVerticalData

export interface Contact {
  id: string
  tenantId: string
  locationId: string | null
  fullName: string
  email: string | null
  phone: string | null
  phoneAlt: string | null
  source: ContactSource
  tags: string[]
  notes: string | null
  verticalData: VerticalData
  isArchived: boolean
  lastContacted: string | null
  email_risk_score: number | null
  email_status: 'ok' | 'soft_bounce' | 'hard_bounce' | 'complained' | 'unsubscribed' | null
  createdAt: string
  updatedAt: string
}

export interface Appointment {
  id: string
  tenantId: string
  locationId: string | null
  contactId: string
  assignedUserId: string | null
  createdByCall: string | null
  googleEventId: string | null
  title: string
  description: string | null
  startTime: string
  endTime: string
  status: AppointmentStatus
  notes: string | null
  reminder24hSent: boolean
  reminder2hSent: boolean
  reviewRequested: boolean
  canceledAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Call {
  id: string
  tenantId: string
  locationId: string | null
  contactId: string | null
  callerNumber: string
  direction: CallDirection
  status: CallStatus
  durationSeconds: number
  recordingS3Key: string | null
  aiHandled: boolean
  aiIntent: string | null
  aiOutcome: string | null
  costTelnyxCents: number
  costDeepgramCents: number
  costClaudeCents: number
  costElevenlabsCents: number
  costTotalCents: number
  startedAt: string | null
  endedAt: string | null
  createdAt: string
}

export interface CallTranscript {
  id: string
  callId: string
  tenantId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sequenceNum: number
  timestampMs: number
  createdAt: string
}

export interface PipelineStage {
  id: string
  tenantId: string
  name: string
  position: number
  color: string
  isDefault: boolean
  isTerminal: boolean
  createdAt: string
}

export interface PipelineEntry {
  id: string
  tenantId: string
  contactId: string
  stageId: string
  assignedUserId: string | null
  status: 'active' | 'won' | 'lost'
  enteredAt: string
  notes: string | null
  valueCents: number
  createdAt: string
  updatedAt: string
}

export interface AutomationRule {
  id: string
  tenantId: string
  type: AutomationType
  name: string
  isEnabled: boolean
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ── SMS Messages ─────────────────────────────────────────────

export interface SmsMessage {
  id: string
  tenant_id: string
  contact_id: string | null
  direction: 'inbound' | 'outbound'
  body: string
  from_number: string
  to_number: string
  message_sid: string | null
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received'
  ai_handled: boolean
  ai_response: string | null
  created_at: string
}

// ── Conversations ────────────────────────────────────────────

export interface Conversation {
  id: string // contact_id
  contact_id: string
  contact_name: string
  contact_phone: string
  last_message: string
  last_message_at: string
  direction: 'inbound' | 'outbound'
  unread_count: number
  status: 'open' | 'resolved'
  ai_handled: boolean
  assigned_to?: string | null
  assigned_to_name?: string | null
}

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  from_number: string
  to_number: string
  status: string
  ai_handled: boolean
  created_at: string
}

export type ConversationsWsEvent =
  | { type: 'new_message'; conversation_id: string; message: ConversationMessage }
  | { type: 'conversation_resolved'; conversation_id: string }
  | { type: 'conversation_assigned'; conversation_id: string; assigned_to: string | null }
  | { type: 'conversation_reopened'; conversation_id: string }

// ── API response wrappers ────────────────────────────────────

export interface ApiSuccess<T> {
  success: true
  data: T
}

export interface ApiError {
  success: false
  error: string
  code?: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ── Business Profile ─────────────────────────────────────────

export interface DayHours {
  open: string // "09:00"
  close: string // "17:00"
  closed: boolean
}

export interface LocationBusinessHours {
  monday: DayHours
  tuesday: DayHours
  wednesday: DayHours
  thursday: DayHours
  friday: DayHours
  saturday: DayHours
  sunday: DayHours
}

export interface ServiceEntry {
  name: string
  duration_min: number
  price: number
  description: string
}

export interface StaffEntry {
  name: string
  role: string
}

export interface FaqEntry {
  question: string
  answer: string
}

export interface BusinessProfile {
  hours?: Partial<LocationBusinessHours>
  services?: ServiceEntry[]
  staff?: StaffEntry[]
  faqs?: FaqEntry[]
  notes?: string
}

// ── Maya KB Files ─────────────────────────────────────────────

export type MayaKbFileStatus = 'pending' | 'processing' | 'ready' | 'error'

export interface MayaKbFile {
  id: string
  tenantId: string
  locationId: string | null
  fileName: string
  fileSize: number
  storagePath: string
  extractedText: string | null
  status: MayaKbFileStatus
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

// ── Reputation / Google Business Profile ─────────────────────

export interface GbpConnection {
  id: string
  tenantId: string
  locationId: string | null
  googleAccountId: string
  googleLocationName: string
  locationName: string
  placeId: string | null
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  connectedAt: string
}

export type ReviewStatus = 'new' | 'replied' | 'ignored'

export interface Review {
  id: string
  tenantId: string
  googleReviewId: string
  reviewerName: string | null
  rating: number
  comment: string | null
  publishedAt: string | null
  replyText: string | null
  replySentAt: string | null
  aiSuggestedReply: string | null
  status: ReviewStatus
  createdAt: string
}

export interface ReputationStats {
  averageRating: number
  totalReviews: number
  ratingBreakdown: Record<1 | 2 | 3 | 4 | 5, number>
  reviewsThisMonth: number
  reviewsLastMonth: number
  trendData: Array<{ month: string; avgRating: number; count: number }>
}

// ── GBP Insights ──────────────────────────────────────────────

export interface GbpInsights {
  queries_direct: number
  queries_indirect: number
  views_maps: number
  views_search: number
  actions_website: number
  actions_phone: number
  actions_driving_directions: number
  period_days: 30
}

// ── Trigger Links ─────────────────────────────────────────────

export type TriggerLinkAction =
  | 'confirm_appointment'
  | 'cancel_appointment'
  | 'mark_contacted'
  | 'mark_won'
  | 'mark_lost'
  | 'custom_webhook'

export interface TriggerLink {
  id: string
  tenantId: string
  name: string
  slug: string
  action: TriggerLinkAction
  actionConfig: Record<string, unknown>
  clickCount: number
  createdAt: string
  updatedAt: string
}

export interface TriggerLinkEvent {
  id: string
  triggerLinkId: string
  tenantId: string
  contactId: string | null
  clickedAt: string
  ipAddress: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
}

// ── Snippets ──────────────────────────────────────────────────

export interface Snippet {
  id: string
  tenantId: string
  name: string
  shortcut: string
  body: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// ── Review Requests ───────────────────────────────────────────

export type ReviewRequestStatus =
  | 'pending'
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'completed'
  | 'reviewed'

export type ReviewRequestChannel = 'sms' | 'email'

export interface ReviewRequest {
  id: string
  tenantId: string
  contactId: string | null
  appointmentId: string | null
  channel: ReviewRequestChannel
  status: ReviewRequestStatus
  sentAt: string | null
  openedAt: string | null
  clickedAt: string | null
  completedAt: string | null
  reviewUrl: string | null
  messageSid: string | null
  createdAt: string
  updatedAt: string | null
}

export interface ReviewRequestStats {
  totalSent: number
  totalOpened: number
  totalClicked: number
  totalCompleted: number
  openRate: number
  clickRate: number
  completionRate: number
  byChannel: {
    sms: { sent: number; opened: number; clicked: number; completed: number }
    email: { sent: number; opened: number; clicked: number; completed: number }
  }
  last30Days: { sent: number; clicked: number; completed: number }
}

// ── Automation Overview ───────────────────────────────────────

export interface FailedJob {
  id: string
  name: string
  failed_at: string | null
  error_message: string
  attempt_count: number
}

export interface ScannerPause {
  id: string
  tenant_id: string
  scanner_key: string
  paused_from: string
  paused_until: string
  reason: string | null
  created_at: string
}

export interface ScannerStatus {
  name: string // human-readable: "Stalled Lead Scanner", etc.
  key: string // internal BullMQ queue name
  status: 'active' | 'paused' | 'error'
  last_run_at: string | null
  last_error: string | null
  failure_count: number
  jobs_processed_7d: number
  failed_jobs: FailedJob[]
  is_paused: boolean
  pause_until: string | null
}

export interface AutomationOverview {
  scanners: ScannerStatus[]
  enrollments_chart: Array<{ week: string; count: number }>
  trigger_analysis: {
    attempted: number
    matched: number
    unmatched: number
  }
  total_active: number
  total_paused: number
}

// ── Conversations Analytics ───────────────────────────────────

export interface ConversationAnalytics {
  period_days: number
  total_conversations: number
  open_conversations: number
  resolved_conversations: number
  avg_response_time_minutes: number | null
  ai_handled_count: number
  ai_handled_pct: number
  busiest_hour: number | null
  volume_by_day: Array<{ date: string; inbound: number; outbound: number }>
}

// ── SMS Health ────────────────────────────────────────────────

export interface SmsDeliveryAlert {
  level: 'ok' | 'warning' | 'critical'
  message: string | null
}

export interface SmsDeliveryError {
  error_code: string
  error_title: string
  count: number
}

export interface SmsHealthStats {
  period_days: number
  total_sent: number
  total_delivered: number
  total_failed: number
  total_opted_out: number
  delivery_rate: number
  failure_rate: number
  error_breakdown: SmsDeliveryError[]
  trend_7d: Array<{ date: string; sent: number; delivered: number; failed: number }>
  alert: SmsDeliveryAlert
}

// ── Email Health ──────────────────────────────────────────────

export interface EmailEvent {
  id: string
  tenant_id: string
  contact_id: string | null
  email_address: string
  event_type:
    | 'sent'
    | 'delivered'
    | 'opened'
    | 'clicked'
    | 'bounced_hard'
    | 'bounced_soft'
    | 'complained'
    | 'unsubscribed'
  resend_email_id: string | null
  bounce_type: string | null
  bounce_subtype: string | null
  created_at: string
}

export interface EmailHealthAlert {
  level: 'ok' | 'warning' | 'critical'
  message: string | null
}

export interface EmailHealthStats {
  period_days: number
  total_sent: number
  total_delivered: number
  total_hard_bounced: number
  total_soft_bounced: number
  total_complained: number
  total_unsubscribed: number
  delivery_rate: number
  hard_bounce_rate: number
  complaint_rate: number
  suppressed_contacts: number
  at_risk_contacts: number
  alert: EmailHealthAlert
  trend_7d: Array<{ date: string; sent: number; delivered: number; bounced: number }>
}

// ── Weekly Digest ─────────────────────────────────────────

export interface WeeklyDigestData {
  period: { from: string; to: string }
  business_name: string
  contacts: {
    new_this_week: number
    total: number
    change_pct: number | null
  }
  appointments: {
    booked_this_week: number
    showed: number
    no_show: number
    upcoming_7d: number
  }
  pipeline: {
    new_deals: number
    deals_won: number
    revenue_won: number
    open_pipeline_value: number
  }
  maya_calls: {
    total_this_week: number
    bookings_from_calls: number
    avg_duration_seconds: number | null
  }
  sms_health: {
    sent_this_week: number
    delivery_rate: number | null
  }
  top_insight: string | null
}

// ── Square Integration ────────────────────────────────────────

export interface SquareConnection {
  id: string
  tenant_id: string
  square_merchant_id: string
  square_location_id: string | null
  access_token: string
  refresh_token: string
  token_expires_at: string
  connected_at: string
}

export interface SquarePayment {
  paymentId: string
  status: string
  receiptUrl: string | null
  amountCents: number
  currency: string
}

// ── Quotes ───────────────────────────────────────────────────

export interface Quote {
  id: string
  tenant_id: string
  contact_id: string | null
  quote_number: string
  title: string
  status: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  notes: string | null
  valid_until: string | null
  sent_at: string | null
  accepted_at: string | null
  declined_at: string | null
  created_by: string | null
  share_token: string
  created_at: string
  updated_at: string
  discount_pct: number | null
  discount_amount: number | null
  approval_status: string | null
  approval_note: string | null
  approved_by: string | null
  approved_at: string | null
  deposit_pct: number | null
  deposit_amount: number | null
  remaining_balance: number | null
  payment_status: string | null
  requires_signature?: boolean | null
  signature_data?: string | null
  signed_by_name?: string | null
  signed_at?: string | null
  signed_ip?: string | null
  signature_status?: 'none' | 'waiting' | 'signed' | 'declined' | null
}

// ── Quote Payments ───────────────────────────────────────────

export interface QuotePayment {
  id: string
  quote_id: string
  tenant_id: string
  amount: number
  method: string
  provider?: 'stripe' | 'square' | 'cash' | 'check' | 'other'
  square_payment_id?: string | null
  reference?: string | null
  notes?: string | null
  recorded_at: string
}

// ── Invoices ─────────────────────────────────────────────────

export interface InvoiceLineItem {
  id: string
  invoice_id: string
  tenant_id: string
  description: string
  quantity: number
  unit_price: number
  amount: number // generated column: quantity * unit_price
  sort_order: number
}

export interface Invoice {
  id: string
  tenant_id: string
  contact_id: string | null
  deal_id: string | null
  invoice_number: string
  status: 'draft' | 'sent' | 'due' | 'received' | 'overdue' | 'void'
  issue_date: string
  due_date: string | null
  subtotal: number
  tax_rate: number | null
  tax_amount: number | null
  total: number
  amount_paid: number | null
  balance_due: number | null // generated column
  notes: string | null
  paid_at: string | null
  sent_at: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
  // Relations (optional, from joins)
  contacts?: { full_name: string; email?: string | null; phone?: string | null } | null
  line_items?: InvoiceLineItem[]
}

// ── Subscriptions ─────────────────────────────────────────────────

export interface ClientSubscription {
  id: string
  tenant_id: string
  contact_id: string
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  name: string
  description: string | null
  amount: number
  currency: string
  interval: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  interval_count: number
  status: 'active' | 'paused' | 'cancelled' | 'past_due' | 'incomplete'
  stripe_price_id: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  // Relations
  contacts?: { full_name: string; email?: string | null } | null
}

// ── Campaign prerequisites ────────────────────────────────────────────────────
export interface CampaignPrereqCheck {
  key: string
  label: string
  status: 'pass' | 'fail' | 'warning'
  detail: string
  action_url: string | null
}

export interface CampaignPrereqResult {
  ready: boolean
  checks: CampaignPrereqCheck[]
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'paused'
export type CampaignType = 'email' | 'sms'
export type CampaignRecipientStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed'
  | 'suppressed'

export interface Campaign {
  id: string
  tenant_id: string
  name: string
  type: CampaignType
  status: CampaignStatus
  subject: string | null
  body_html: string | null
  body_text: string | null
  smart_list_id: string | null
  scheduled_at: string | null
  sent_at: string | null
  cancelled_at: string | null
  recipient_count: number
  sent_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CampaignRecipient {
  id: string
  campaign_id: string
  tenant_id: string
  contact_id: string
  email: string
  status: CampaignRecipientStatus
  resend_email_id: string | null
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  error_message: string | null
}

export interface CampaignStats {
  recipient_count: number
  sent_count: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  failed: number
  open_rate: number
  click_rate: number
  bounce_rate: number
  status_breakdown: Record<CampaignRecipientStatus, number>
}

// ── Brand Voice ───────────────────────────────────────────────
export interface BrandVoice {
  tone?: 'professional' | 'friendly' | 'casual' | 'authoritative' | 'warm'
  formality?: 'formal' | 'semi-formal' | 'informal'
  emoji_use?: 'none' | 'minimal' | 'moderate'
  industry_terms?: string[] // up to 10
  avoid_phrases?: string[] // up to 10
  signature?: string // max 100 chars
  sample_message?: string // max 500 chars
}

// ── Webchat ───────────────────────────────────────────────────
export type WebchatSessionStatus = 'active' | 'closed'
export type WebchatMessageRole = 'user' | 'assistant' | 'agent'

export interface WebchatSession {
  id: string
  tenant_id: string
  location_id: string | null
  contact_id: string | null
  session_token: string
  status: WebchatSessionStatus
  visitor_name: string | null
  visitor_email: string | null
  started_at: string
  ended_at: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface WebchatMessage {
  id: string
  session_id: string
  role: WebchatMessageRole
  content: string
  created_at: string
}

export interface WebchatConfig {
  enabled: boolean
  greeting: string
  color: string
  position: 'bottom-right' | 'bottom-left'
}

// ── Outbound Calls ────────────────────────────────────────────
export type OutboundCallTriggerType =
  | 'manual'
  | 'lead_status'
  | 'deal_stage'
  | 'no_response'
  | 'follow_up_sequence'

export type OutboundCallStatus =
  | 'pending'
  | 'dialing'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'cancelled'

export interface OutboundCallJob {
  id: string
  tenant_id: string
  contact_id: string
  trigger_type: OutboundCallTriggerType
  trigger_config: Record<string, unknown>
  status: OutboundCallStatus
  call_id: string | null
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  attempts: number
  max_attempts: number
  error_message: string | null
  notes: string | null
  created_at: string
  // joined fields (optional)
  contact_name?: string | null
  contact_phone?: string | null
}

// ── Portal ────────────────────────────────────────────────────────────────────

export interface PortalAccess {
  id: string
  tenant_id: string
  contact_id: string
  access_token: string
  email: string
  last_accessed_at: string | null
  expires_at: string | null
  created_at: string
  // joined
  contact_name?: string | null
}

export interface PortalSettings {
  portal_enabled: boolean
  portal_slug: string | null
  portal_url: string | null
  access_count: number
}

export interface PortalAppointment {
  id: string
  scheduled_at: string
  service_name: string | null
  status: string
  location_id: string | null
}

export interface PortalQuote {
  id: string
  quote_number: string | null
  description: string | null
  total: number
  status: string
  created_at: string
  public_token: string | null
}

export interface PortalInvoice {
  id: string
  invoice_number: string | null
  total: number
  balance_due: number
  status: string
  due_date: string | null
  created_at: string
}

export interface PortalData {
  contact: { full_name: string | null; email: string | null; phone: string | null } | null
  appointments: {
    upcoming: PortalAppointment[]
    past: PortalAppointment[]
  }
  quotes: PortalQuote[]
  invoices: PortalInvoice[]
  documents: unknown[]
}

export interface PortalVerifyResult {
  valid: boolean
  contact_id?: string
  tenant_id?: string
  contact_name?: string | null
  business_name?: string | null
  portal_slug?: string | null
}

// ── Video Testimonials ────────────────────────────────────────────────────────

export type VideoCollectorStatus = 'active' | 'paused' | 'archived'
export type VideoTestimonialStatus = 'pending' | 'approved' | 'rejected' | 'featured'
export type VideoSentiment = 'positive' | 'neutral' | 'negative'

export interface VideoCollector {
  id: string
  tenant_id: string
  name: string
  slug: string
  prompt: string
  max_duration_seconds: number
  status: VideoCollectorStatus
  submission_count: number
  created_at: string
  // computed
  collect_url?: string
}

export interface VideoTestimonial {
  id: string
  tenant_id: string
  collector_id: string
  contact_id: string | null
  submitter_name: string | null
  submitter_email: string | null
  storage_path: string
  thumbnail_path: string | null
  duration_seconds: number | null
  status: VideoTestimonialStatus
  transcript: string | null
  sentiment: VideoSentiment | null
  submitted_at: string
  reviewed_at: string | null
  created_at: string
  // joined / computed
  signed_url?: string | null
}

// ── Maya KB URLs ──────────────────────────────────────────────────────────────

export type MayaKbUrlStatus = 'pending' | 'crawling' | 'ready' | 'error'

export interface MayaKbUrl {
  id: string
  tenant_id: string
  url: string
  status: MayaKbUrlStatus
  pages_crawled: number
  extracted_text: string | null
  error_message: string | null
  last_crawled_at: string | null
  created_at: string
  updated_at: string
}
