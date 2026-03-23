// =============================================================
//  Nuatis — Shared TypeScript Types
//  These mirror the PostgreSQL schema in nuatis-schema.sql
//  Import in api and web: import { Tenant, Contact } from '@nuatis/shared'
// =============================================================

// ── Enums (mirror PostgreSQL enums) ─────────────────────────

export type VerticalType =
  | 'dental'
  | 'contractor'
  | 'salon'
  | 'law_firm'
  | 'restaurant'
  | 'real_estate'

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

export type CallStatus =
  | 'ringing'
  | 'active'
  | 'completed'
  | 'missed'
  | 'failed'
  | 'voicemail'

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
  clerkOrgId: string
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
  clerkUserId: string
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
  caseType?: 'family' | 'criminal_defense' | 'personal_injury' | 'corporate' | 'real_estate' | 'immigration' | 'other'
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
