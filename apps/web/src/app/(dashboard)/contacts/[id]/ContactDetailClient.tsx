'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AddNoteForm from '@/components/contacts/AddNoteForm'
import ContactTasks from '@/components/contacts/ContactTasks'
import ActivityTimeline from '@/components/contacts/ActivityTimeline'
import FileAttachments from '@/components/contacts/FileAttachments'
import SmsThread from '@/components/contacts/SmsThread'
import ContactDeals from '@/components/contacts/ContactDeals'
import EmailComposeModal from '../../../../components/contacts/EmailComposeModal'
import ContactHeader, { type ContactFields } from './ContactHeader'

type Tab = 'activity' | 'messages' | 'files'
type RightPanel =
  | 'activities'
  | 'notes'
  | 'appointments'
  | 'opportunities'
  | 'documents'
  | 'payments'

const TAG_COLORS = [
  'bg-teal-50 text-teal-700 border-teal-200',
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-purple-50 text-purple-700 border-purple-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-green-50 text-green-700 border-green-200',
]

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!
}

interface Appt {
  id: string
  title: string
  start_time: string
  status: string
}

interface InitialContact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  phone_alt: string | null
  source: string | null
  referral_source_detail: string | null
  pipeline_stage: string | null
  tags: string[]
  notes: string | null
  created_at: string
  last_contacted: string | null
}

interface Props {
  contact: InitialContact
}

// SVG icon components for the right rail
function IconClock() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
function IconFileText() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}
function IconTrendingUp() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}
function IconPaperclip() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}
function IconCreditCard() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )
}

const RAIL_ICONS: Array<{ key: RightPanel; label: string; Icon: () => React.JSX.Element }> = [
  { key: 'activities', label: 'Activities', Icon: IconClock },
  { key: 'notes', label: 'Notes', Icon: IconFileText },
  { key: 'appointments', label: 'Appointments', Icon: IconCalendar },
  { key: 'opportunities', label: 'Opportunities', Icon: IconTrendingUp },
  { key: 'documents', label: 'Documents', Icon: IconPaperclip },
  { key: 'payments', label: 'Payments', Icon: IconCreditCard },
]

export default function ContactDetailClient({ contact: initial }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const contactId = initial.id
  const contactName = initial.full_name

  // Contact fields state for ContactHeader and EmailComposeModal
  const [headerContact, setHeaderContact] = useState<ContactFields>({
    id: initial.id,
    full_name: initial.full_name,
    email: initial.email,
    phone: initial.phone,
    phone_alt: initial.phone_alt,
    source: initial.source,
    referral_source_detail: initial.referral_source_detail,
    tags: initial.tags ?? [],
    notes: initial.notes,
    pipeline_stage: initial.pipeline_stage,
  })

  // Panel & tab state
  const initialTab = (searchParams.get('tab') as Tab) ?? 'activity'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [activePanel, setActivePanel] = useState<RightPanel | null>(null)

  // Shared state
  const [refreshKey, setRefreshKey] = useState(0)
  const [smsUnread, setSmsUnread] = useState(0)
  const [fileCount, setFileCount] = useState(0)
  const [showEmailModal, setShowEmailModal] = useState(false)

  // Tags (left panel editor + center header chips)
  const [tags, setTags] = useState<string[]>(initial.tags ?? [])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)

  // Referral fields
  const [referralSource, setReferralSource] = useState(initial.referral_source_detail ?? '')
  const [referralSuggestions, setReferralSuggestions] = useState<string[]>([])
  const [showReferralSuggestions, setShowReferralSuggestions] = useState(false)
  const [referredByName, setReferredByName] = useState<string | null>(null)
  const [referredById, setReferredById] = useState<string | null>(null)
  const [editingReferral, setEditingReferral] = useState(false)

  // Enrichment suggestion
  const [enrichmentSuggestion, setEnrichmentSuggestion] = useState<string | null>(null)

  // Assigned To
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null)
  const [tenantUsers, setTenantUsers] = useState<{ id: string; full_name: string }[]>([])

  // Compliance
  interface ComplianceFieldDef {
    key: string
    label: string
    type: 'boolean' | 'boolean_with_date' | 'boolean_with_notes'
    required?: boolean
  }
  const [complianceFields, setComplianceFields] = useState<ComplianceFieldDef[]>([])
  const [complianceValues, setComplianceValues] = useState<Record<string, unknown>>({})
  const [complianceSaving, setComplianceSaving] = useState(false)

  // Lifecycle & lead score
  type LifecycleStage =
    | 'subscriber'
    | 'lead'
    | 'marketing_qualified'
    | 'sales_qualified'
    | 'opportunity'
    | 'customer'
    | 'evangelist'
    | 'other'
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage | null>(null)
  const [leadScore, setLeadScore] = useState<number | null>(null)
  const [leadGrade, setLeadGrade] = useState<string | null>(null)
  const [leadScoreUpdatedAt, setLeadScoreUpdatedAt] = useState<string | null>(null)
  const [recalculating, setRecalculating] = useState(false)

  // Prev/Next nav
  const [contactIds, setContactIds] = useState<string[]>([])
  const currentIndex = contactIds.indexOf(contactId)
  const prevId = currentIndex > 0 ? (contactIds[currentIndex - 1] ?? null) : null
  const nextId =
    currentIndex !== -1 && currentIndex < contactIds.length - 1
      ? (contactIds[currentIndex + 1] ?? null)
      : null
  const displayIndex = currentIndex >= 0 ? currentIndex + 1 : null
  const totalCount = contactIds.length

  // Right panel appointments
  const [rightAppts, setRightAppts] = useState<Appt[]>([])

  // Left panel tab + DnD opt-ins + metadata
  const [leftTab, setLeftTab] = useState<'fields' | 'dnd'>('fields')
  const [smsOptIn, setSmsOptIn] = useState(false)
  const [emailOptIn, setEmailOptIn] = useState<boolean | null>(null)
  const [callOptIn, setCallOptIn] = useState<boolean | null>(null)
  const [hideEmpty, setHideEmpty] = useState(false)
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)

  // G25h — Ownership / Followers
  const [followers, setFollowers] = useState<string[]>([])
  const [showFollowerPicker, setShowFollowerPicker] = useState(false)

  // G25e — Compose bar
  const [composeTab, setComposeTab] = useState<'sms' | 'note'>('sms')
  const [smsText, setSmsText] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  const fetchContactData = () => {
    void fetch(`/api/contacts/${contactId}`)
      .then((r) => r.json())
      .then(
        (c: {
          referral_source_detail?: string
          referred_by_contact_id?: string
          email?: string
          phone?: string
          full_name?: string
          tags?: string[]
          lifecycle_stage?: LifecycleStage
          lead_score?: number
          lead_grade?: string
          lead_score_updated_at?: string
          assigned_to_user_id?: string | null
          custom_fields?: Record<string, unknown>
          enrichment_suggested_company?: string | null
          compliance_fields?: Record<string, unknown>
          source?: string | null
          referral_source_detail_full?: string
          phone_alt?: string | null
          pipeline_stage?: string | null
          notes?: string | null
          sms_opt_in?: boolean | null
          email_opt_in?: boolean | null
          call_opt_in?: boolean | null
          created_by_user_id?: string | null
          followers?: string[] | null
        }) => {
          // Update header contact data
          setHeaderContact((prev) => ({
            ...prev,
            full_name: c.full_name ?? prev.full_name,
            email: c.email !== undefined ? (c.email ?? null) : prev.email,
            phone: c.phone !== undefined ? (c.phone ?? null) : prev.phone,
            tags: Array.isArray(c.tags) ? c.tags : prev.tags,
            referral_source_detail:
              c.referral_source_detail !== undefined
                ? (c.referral_source_detail ?? null)
                : prev.referral_source_detail,
          }))
          if (Array.isArray(c.tags)) setTags(c.tags)
          if (c.referral_source_detail) setReferralSource(c.referral_source_detail)
          setAssignedUserId(c.assigned_to_user_id ?? null)
          const suggestion =
            c.enrichment_suggested_company ??
            (c.custom_fields?.enrichment_suggested_company as string | undefined) ??
            null
          setEnrichmentSuggestion(suggestion || null)
          if (c.referred_by_contact_id) {
            setReferredById(c.referred_by_contact_id)
            void fetch(`/api/contacts/${c.referred_by_contact_id}`)
              .then((r2) => r2.json())
              .then((ref: { full_name?: string }) => {
                if (ref.full_name) setReferredByName(ref.full_name)
              })
              .catch(() => {})
          }
          if (c.lifecycle_stage) setLifecycleStage(c.lifecycle_stage)
          if (c.lead_score !== undefined && c.lead_score !== null) setLeadScore(c.lead_score)
          if (c.lead_grade) setLeadGrade(c.lead_grade)
          if (c.lead_score_updated_at) setLeadScoreUpdatedAt(c.lead_score_updated_at)
          if (c.compliance_fields) setComplianceValues(c.compliance_fields)
          if (typeof c.sms_opt_in === 'boolean') setSmsOptIn(c.sms_opt_in)
          if (typeof c.email_opt_in === 'boolean') setEmailOptIn(c.email_opt_in)
          if (typeof c.call_opt_in === 'boolean') setCallOptIn(c.call_opt_in)
          setCreatedByUserId(c.created_by_user_id ?? null)
          if (Array.isArray(c.followers)) setFollowers(c.followers)
        }
      )
      .catch(() => {})
  }

  useEffect(() => {
    fetchContactData()

    void fetch('/api/contacts/referral-sources')
      .then((r) => r.json())
      .then((d: { sources: string[] }) => setReferralSuggestions(d.sources))
      .catch(() => {})

    void fetch('/api/contacts/tags')
      .then((r) => r.json())
      .then((d: { tags: string[] }) => setTagSuggestions(d.tags ?? []))
      .catch(() => {})

    void fetch(`/api/contacts/${contactId}/sms`)
      .then((r) => r.json())
      .then((d: { unread_count: number }) => setSmsUnread(d.unread_count))
      .catch(() => {})

    void fetch(`/api/contacts/${contactId}/attachments`)
      .then((r) => r.json())
      .then((d: { attachments: unknown[] }) => setFileCount(d.attachments.length))
      .catch(() => {})
  }, [contactId])

  useEffect(() => {
    const stored = localStorage.getItem('nuatis_contact_hide_empty')
    if (stored === 'true') setHideEmpty(true)
  }, [])

  useEffect(() => {
    void fetch('/api/users')
      .then((r) => r.json())
      .then((d: { users: { id: string; full_name: string }[] }) => {
        if (d.users) setTenantUsers(d.users)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    void fetch('/api/settings/calendar/compliance-fields')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { fields?: ComplianceFieldDef[] } | null) => {
        if (d?.fields && d.fields.length > 0) setComplianceFields(d.fields)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    void fetch('/api/contacts?limit=200')
      .then((r) => r.json())
      .then((d: { contacts: { id: string }[] }) => {
        setContactIds((d.contacts ?? []).map((c) => c.id))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activePanel !== 'appointments') return
    void fetch(`/api/appointments?contact_id=${contactId}&limit=20`)
      .then((r) => r.json())
      .then((d: { appointments: Appt[] }) => setRightAppts(d.appointments ?? []))
      .catch(() => {})
  }, [activePanel, contactId])

  const handleAssigneeChange = async (userId: string | null) => {
    setAssignedUserId(userId)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to_user_id: userId }),
    }).catch(() => {})
  }

  const handleLinkCompany = async () => {
    if (!enrichmentSuggestion) return
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: enrichmentSuggestion,
        custom_fields: { enrichment_suggested_company: null },
      }),
    }).catch(() => {})
    setEnrichmentSuggestion(null)
  }

  const handleDismissEnrichment = async () => {
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_fields: { enrichment_suggested_company: null } }),
    }).catch(() => {})
    setEnrichmentSuggestion(null)
  }

  const handleNoteAdded = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const saveReferralSource = async (value: string) => {
    setReferralSource(value)
    setEditingReferral(false)
    setShowReferralSuggestions(false)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referral_source_detail: value || null }),
    })
  }

  const removeReferredBy = async () => {
    setReferredById(null)
    setReferredByName(null)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referred_by_contact_id: null }),
    })
  }

  const lifecycleOptions: Array<{ value: LifecycleStage; label: string }> = [
    { value: 'subscriber', label: 'Subscriber' },
    { value: 'lead', label: 'Lead' },
    { value: 'marketing_qualified', label: 'Marketing Qualified' },
    { value: 'sales_qualified', label: 'Sales Qualified' },
    { value: 'opportunity', label: 'Opportunity' },
    { value: 'customer', label: 'Customer' },
    { value: 'evangelist', label: 'Evangelist' },
    { value: 'other', label: 'Other' },
  ]

  const lifecycleBadgeClass = (stage: LifecycleStage | null): string => {
    switch (stage) {
      case 'subscriber':
        return 'bg-bg2 text-ink2'
      case 'lead':
        return 'bg-blue-100 text-blue-700'
      case 'marketing_qualified':
        return 'bg-purple-100 text-purple-700'
      case 'sales_qualified':
        return 'bg-orange-100 text-orange-700'
      case 'opportunity':
        return 'bg-yellow-100 text-yellow-700'
      case 'customer':
        return 'bg-green-100 text-green-700'
      case 'evangelist':
        return 'bg-emerald-100 text-emerald-700'
      case 'other':
        return 'bg-bg2 text-ink2'
      default:
        return 'bg-bg2 text-ink3'
    }
  }

  const lifecycleLabel = (stage: LifecycleStage | null): string =>
    lifecycleOptions.find((o) => o.value === stage)?.label ?? 'Not set'

  const gradeBadgeClass = (grade: string | null): string => {
    switch (grade) {
      case 'A':
        return 'bg-green-100 text-green-700'
      case 'B':
        return 'bg-blue-100 text-blue-700'
      case 'C':
        return 'bg-yellow-100 text-yellow-700'
      case 'D':
        return 'bg-orange-100 text-orange-700'
      case 'F':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-bg2 text-ink3'
    }
  }

  const formatRelativeTime = (iso: string | null): string => {
    if (!iso) return 'Never'
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const handleLifecycleChange = async (newStage: LifecycleStage) => {
    setLifecycleStage(newStage)
    await fetch(`/api/contacts/${contactId}/lifecycle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lifecycle_stage: newStage }),
    }).catch(() => {})
  }

  const handleRecalculate = async () => {
    setRecalculating(true)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {})
    setTimeout(() => {
      fetchContactData()
      setRecalculating(false)
    }, 3000)
  }

  const handleComplianceChange = (key: string, value: unknown) => {
    setComplianceValues((prev) => ({ ...prev, [key]: value }))
  }

  const saveComplianceFields = async () => {
    setComplianceSaving(true)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compliance_fields: complianceValues }),
    }).catch(() => {})
    setComplianceSaving(false)
  }

  const saveFollowers = async (next: string[]) => {
    setFollowers(next)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followers: next }),
    }).catch(() => {})
  }

  const addFollower = (userId: string) => {
    if (!followers.includes(userId)) void saveFollowers([...followers, userId])
    setShowFollowerPicker(false)
  }

  const removeFollower = (userId: string) => {
    void saveFollowers(followers.filter((f) => f !== userId))
  }

  const handleSendSms = async () => {
    const text = smsText.trim()
    if (!text || !headerContact.phone || !smsOptIn) return
    setSmsSending(true)
    await fetch(`/api/contacts/${contactId}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }).catch(() => {})
    setSmsText('')
    setRefreshKey((k) => k + 1)
    setSmsSending(false)
  }

  const handleSaveNote = async () => {
    const content = noteText.trim()
    if (!content) return
    setNoteSaving(true)
    await fetch(`/api/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type: 'internal' }),
    }).catch(() => {})
    setNoteText('')
    setRefreshKey((k) => k + 1)
    setNoteSaving(false)
  }

  const handleOptInToggle = async (
    field: 'sms_opt_in' | 'email_opt_in' | 'call_opt_in',
    value: boolean
  ) => {
    if (field === 'sms_opt_in') setSmsOptIn(value)
    else if (field === 'email_opt_in') setEmailOptIn(value)
    else setCallOptIn(value)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {})
  }

  const complianceRequiredFields = complianceFields.filter((f) => f.required)
  const complianceCompleteCount = complianceRequiredFields.filter((f) => {
    const val = complianceValues[f.key]
    if (typeof val === 'boolean') return val
    if (val && typeof val === 'object') return !!(val as Record<string, unknown>)['checked']
    return false
  }).length
  const allComplianceComplete =
    complianceRequiredFields.length > 0 &&
    complianceCompleteCount === complianceRequiredFields.length

  const filteredSuggestions = referralSuggestions.filter(
    (s) => s.toLowerCase().includes(referralSource.toLowerCase()) && s !== referralSource
  )

  const filteredTagSuggestions = tagSuggestions.filter(
    (s) => s.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(s)
  )

  const saveTags = async (newTags: string[]) => {
    setTags(newTags)
    setHeaderContact((prev) => ({ ...prev, tags: newTags }))
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    }).catch(() => {})
  }

  const removeTag = (tag: string) => {
    void saveTags(tags.filter((t) => t !== tag))
  }

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return
    void saveTags([...tags, trimmed])
    setTagInput('')
    setAddingTag(false)
    setShowTagSuggestions(false)
  }

  const togglePanel = (panel: RightPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'activity', label: 'Activity' },
    { key: 'messages', label: 'Messages', badge: smsUnread > 0 ? smsUnread : undefined },
    { key: 'files', label: 'Files', badge: fileCount > 0 ? fileCount : undefined },
  ]

  const apptStatusClass = (status: string) => {
    if (status === 'completed') return 'bg-green-50 text-green-700'
    if (status === 'confirmed') return 'bg-teal-50 text-teal-700'
    if (status === 'no_show') return 'bg-red-50 text-red-700'
    return 'bg-bg2 text-ink3'
  }

  const renderRightPanelContent = () => {
    switch (activePanel) {
      case 'activities':
        return <ActivityTimeline contactId={contactId} refreshKey={refreshKey} />
      case 'notes':
        return (
          <div className="p-4">
            <AddNoteForm contactId={contactId} onNoteAdded={handleNoteAdded} />
          </div>
        )
      case 'appointments':
        return rightAppts.length === 0 ? (
          <p className="text-sm text-ink4 p-4">No appointments found.</p>
        ) : (
          <div className="divide-y divide-border-brand">
            {rightAppts.map((a) => (
              <div key={a.id} className="px-4 py-3">
                <p className="text-sm font-medium text-ink2 mb-0.5">{a.title}</p>
                <p className="text-xs text-ink4">
                  {new Date(a.start_time).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                <span
                  className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${apptStatusClass(a.status)}`}
                >
                  {a.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )
      case 'opportunities':
        return (
          <div className="p-4">
            <ContactDeals contactId={contactId} />
          </div>
        )
      case 'documents':
        return <FileAttachments contactId={contactId} />
      case 'payments':
        return (
          <div className="flex flex-col items-center justify-center h-40 text-center px-4">
            <p className="text-sm text-ink4">No accepted quotes yet.</p>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── LEFT PANEL — tabbed (320px) ── */}
      <div className="w-80 flex-shrink-0 border-r border-border-brand bg-white flex flex-col">
        {/* Tab bar */}
        <div className="flex border-b border-border-brand shrink-0">
          {(['fields', 'dnd'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setLeftTab(tab)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                leftTab === tab
                  ? 'text-teal-700 border-b-2 border-teal-600 -mb-px'
                  : 'text-ink3 hover:text-ink2'
              }`}
            >
              {tab === 'fields' ? 'Fields' : 'DND & Actions'}
            </button>
          ))}
        </div>

        {/* Fields tab */}
        {leftTab === 'fields' && (
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            {/* Referral Info */}
            {!(hideEmpty && !referralSource && !referredByName && !referredById) && (
              <section>
                <h2 className="text-[10px] font-semibold text-ink4 uppercase tracking-wider mb-3">
                  Referral Info
                </h2>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-ink4 text-xs block mb-0.5">Referral Source</span>
                    {editingReferral ? (
                      <div className="relative">
                        <input
                          type="text"
                          value={referralSource}
                          onChange={(e) => {
                            setReferralSource(e.target.value)
                            setShowReferralSuggestions(true)
                          }}
                          onBlur={() => {
                            setTimeout(() => setShowReferralSuggestions(false), 200)
                            void saveReferralSource(referralSource)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveReferralSource(referralSource)
                            if (e.key === 'Escape') setEditingReferral(false)
                          }}
                          placeholder="e.g. Google, Instagram, Friend"
                          autoFocus
                          className="w-full text-sm border border-border-brand rounded px-2 py-1"
                        />
                        {showReferralSuggestions && filteredSuggestions.length > 0 && (
                          <div className="absolute top-full left-0 w-full mt-1 bg-white border border-border-brand rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                            {filteredSuggestions.slice(0, 5).map((s) => (
                              <button
                                key={s}
                                onMouseDown={() => void saveReferralSource(s)}
                                className="block w-full text-left text-xs px-2 py-1.5 hover:bg-bg text-ink3"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p
                        className="text-ink2 cursor-pointer hover:text-teal-600"
                        onClick={() => setEditingReferral(true)}
                      >
                        {referralSource || '—'}
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-ink4 text-xs block mb-0.5">Referred By</span>
                    {referredByName && referredById ? (
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`/contacts/${referredById}`}
                          className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                        >
                          {referredByName}
                        </a>
                        <button
                          onClick={() => void removeReferredBy()}
                          className="text-ink4 hover:text-red-500 text-xs"
                        >
                          &times;
                        </button>
                      </div>
                    ) : (
                      <p className="text-ink2">—</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Ownership — Owner + Followers */}
            <section>
              <h2 className="text-[10px] font-semibold text-ink4 uppercase tracking-wider mb-3">
                Ownership
              </h2>
              {/* Owner */}
              <div className="mb-3">
                <span className="text-ink4 text-xs block mb-1">Owner</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {assignedUserId ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                        <span className="text-teal-700 text-[10px] font-bold">
                          {(tenantUsers.find((u) => u.id === assignedUserId)?.full_name ?? '?')
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm text-ink2">
                        {tenantUsers.find((u) => u.id === assignedUserId)?.full_name ??
                          assignedUserId}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-ink4">Unassigned</span>
                  )}
                  <select
                    value={assignedUserId ?? ''}
                    onChange={(e) => void handleAssigneeChange(e.target.value || null)}
                    className="text-xs border border-border-brand rounded px-1.5 py-1 text-ink3 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="">Unassigned</option>
                    {tenantUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Followers */}
              <div>
                <span className="text-ink4 text-xs block mb-1">Followers</span>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {followers.length === 0 && !showFollowerPicker && (
                    <span className="text-xs text-ink4">No followers</span>
                  )}
                  {followers.map((uid) => {
                    const u = tenantUsers.find((u) => u.id === uid)
                    if (!u) return null
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg2 rounded-full text-xs text-ink2"
                      >
                        <span className="w-4 h-4 rounded-full bg-teal-100 flex items-center justify-center text-[9px] font-bold text-teal-700 shrink-0">
                          {u.full_name.charAt(0).toUpperCase()}
                        </span>
                        {u.full_name}
                        <button
                          onClick={() => removeFollower(uid)}
                          className="ml-0.5 text-ink4 hover:text-red-500 leading-none"
                          aria-label={`Remove ${u.full_name}`}
                        >
                          &times;
                        </button>
                      </span>
                    )
                  })}
                  {showFollowerPicker ? (
                    <div className="relative">
                      <select
                        autoFocus
                        size={1}
                        onChange={(e) => {
                          if (e.target.value) addFollower(e.target.value)
                        }}
                        onBlur={() => setTimeout(() => setShowFollowerPicker(false), 150)}
                        className="text-xs border border-border-brand rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Add follower…
                        </option>
                        {tenantUsers
                          .filter((u) => !followers.includes(u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name}
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowFollowerPicker(true)}
                      className="text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-0.5 rounded-full border border-dashed border-teal-300 hover:border-teal-400 transition-colors"
                    >
                      + Follow
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Lifecycle Stage */}
            {!(hideEmpty && !lifecycleStage) && (
              <section>
                <h2 className="text-[10px] font-semibold text-ink4 uppercase tracking-wider mb-3">
                  Lifecycle Stage
                </h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${lifecycleBadgeClass(lifecycleStage)}`}
                  >
                    {lifecycleLabel(lifecycleStage)}
                  </span>
                  <select
                    value={lifecycleStage ?? ''}
                    onChange={(e) => {
                      if (e.target.value)
                        void handleLifecycleChange(e.target.value as LifecycleStage)
                    }}
                    className="text-sm border border-border-brand rounded px-2 py-1 text-ink3 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="" disabled>
                      Change stage…
                    </option>
                    {lifecycleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            )}

            {/* Lead Score */}
            <section>
              <h2 className="text-[10px] font-semibold text-ink4 uppercase tracking-wider mb-3">
                Lead Score
              </h2>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-4xl font-bold text-ink">
                  {leadScore !== null ? leadScore : '—'}
                </span>
                {leadGrade && (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${gradeBadgeClass(leadGrade)}`}
                  >
                    {leadGrade}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink4 mb-3">
                Last updated: {formatRelativeTime(leadScoreUpdatedAt)}
              </p>
              <button
                onClick={() => void handleRecalculate()}
                disabled={recalculating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-brand bg-white px-3 py-1.5 text-sm font-medium text-ink2 hover:bg-bg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {recalculating ? 'Recalculating…' : 'Recalculate'}
              </button>
            </section>

            {/* Compliance */}
            {complianceFields.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[10px] font-semibold text-ink4 uppercase tracking-wider">
                    Compliance
                  </h2>
                  {allComplianceComplete ? (
                    <span className="text-xs text-green-600 font-medium">All complete</span>
                  ) : (
                    <span className="text-xs text-ink4">
                      {complianceCompleteCount}/{complianceRequiredFields.length} required
                    </span>
                  )}
                </div>
                <div className="space-y-4">
                  {complianceFields.map((field) => {
                    const raw = complianceValues[field.key]
                    const isObj = raw && typeof raw === 'object'
                    const checked = isObj
                      ? !!(raw as Record<string, unknown>)['checked']
                      : typeof raw === 'boolean'
                        ? raw
                        : false
                    const extra = isObj ? (raw as Record<string, unknown>) : {}
                    return (
                      <div key={field.key}>
                        <label className="flex items-start gap-2 text-sm text-ink2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (field.type === 'boolean') {
                                handleComplianceChange(field.key, e.target.checked)
                              } else {
                                handleComplianceChange(field.key, {
                                  ...extra,
                                  checked: e.target.checked,
                                })
                              }
                            }}
                            className="mt-0.5 rounded border-border-brand text-teal-600 focus:ring-teal-500 w-4 h-4"
                          />
                          <span>
                            {field.label}
                            {field.required && <span className="text-red-500 ml-0.5">*</span>}
                          </span>
                        </label>
                        {field.type === 'boolean_with_date' && checked && (
                          <div className="ml-6 mt-1.5">
                            <input
                              type="date"
                              value={(extra['date'] as string | undefined) ?? ''}
                              onChange={(e) =>
                                handleComplianceChange(field.key, {
                                  ...extra,
                                  checked,
                                  date: e.target.value,
                                })
                              }
                              className="text-sm border border-border-brand rounded px-2 py-1 text-ink2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                          </div>
                        )}
                        {field.type === 'boolean_with_notes' && checked && (
                          <div className="ml-6 mt-1.5">
                            <input
                              type="text"
                              value={(extra['notes'] as string | undefined) ?? ''}
                              onChange={(e) =>
                                handleComplianceChange(field.key, {
                                  ...extra,
                                  checked,
                                  notes: e.target.value,
                                })
                              }
                              placeholder="Notes..."
                              className="w-full text-sm border border-border-brand rounded px-2 py-1 text-ink2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button
                  onClick={() => void saveComplianceFields()}
                  disabled={complianceSaving}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border-brand bg-white px-3 py-1.5 text-sm font-medium text-ink2 hover:bg-bg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {complianceSaving ? 'Saving…' : 'Save Compliance'}
                </button>
              </section>
            )}

            {/* G25g — Hide empty + Created by + Audit log */}
            <div className="pt-4 border-t border-border-brand space-y-2">
              <label className="flex items-center gap-2 text-xs text-ink3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={(e) => {
                    setHideEmpty(e.target.checked)
                    localStorage.setItem(
                      'nuatis_contact_hide_empty',
                      e.target.checked ? 'true' : 'false'
                    )
                  }}
                  className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                Hide empty fields
              </label>
              <p className="text-[10px] text-ink4">
                Created by{' '}
                <span className="text-ink3">
                  {createdByUserId
                    ? (tenantUsers.find((u) => u.id === createdByUserId)?.full_name ?? 'System')
                    : 'System'}
                </span>{' '}
                on{' '}
                {new Date(initial.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <a
                href={`/settings/audit-log?resource_id=${contactId}`}
                className="text-[10px] text-teal-600 hover:text-teal-700 hover:underline inline-block"
              >
                View audit log →
              </a>
            </div>
          </div>
        )}

        {/* DND & Actions tab */}
        {leftTab === 'dnd' && (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <p className="text-[10px] font-semibold text-ink4 uppercase tracking-wider mb-4">
              Communication Preferences
            </p>
            <div className="flex items-center justify-between py-3 border-b border-border-brand">
              <div>
                <p className="text-sm font-medium text-ink2">SMS</p>
                <p className="text-xs text-ink4 mt-0.5">Opt in to receive text messages</p>
              </div>
              <button
                onClick={() => void handleOptInToggle('sms_opt_in', !smsOptIn)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${smsOptIn ? 'bg-teal-600' : 'bg-gray-200'}`}
                aria-label="SMS opt-in toggle"
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${smsOptIn ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-border-brand">
              <div>
                <p className="text-sm font-medium text-ink2">Email</p>
                <p className="text-xs text-ink4 mt-0.5">Opt in to receive emails</p>
              </div>
              <button
                onClick={() => void handleOptInToggle('email_opt_in', !(emailOptIn ?? true))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(emailOptIn ?? true) ? 'bg-teal-600' : 'bg-gray-200'}`}
                aria-label="Email opt-in toggle"
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${(emailOptIn ?? true) ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-ink2">Calls</p>
                <p className="text-xs text-ink4 mt-0.5">Opt in to receive calls</p>
              </div>
              <button
                onClick={() => void handleOptInToggle('call_opt_in', !(callOptIn ?? true))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(callOptIn ?? true) ? 'bg-teal-600' : 'bg-gray-200'}`}
                aria-label="Call opt-in toggle"
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${(callOptIn ?? true) ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── CENTER PANEL — flex-1, internal scroll + compose bar ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg overflow-hidden">
        {/* Fixed header */}
        <div className="bg-white border-b border-border-brand px-6 py-4 shrink-0">
          {/* Back + Prev/Next */}
          <div className="flex items-center justify-between mb-4">
            <Link href="/contacts" className="text-ink4 hover:text-ink3 text-sm">
              ← Contacts
            </Link>
            <div className="flex items-center gap-3">
              <button
                disabled={!prevId}
                onClick={() => prevId && router.push(`/contacts/${prevId}`)}
                className={`text-xs transition-opacity ${!prevId ? 'text-ink4 opacity-40 cursor-not-allowed' : 'text-ink3 hover:text-ink2'}`}
              >
                ← Prev
              </button>
              {displayIndex !== null && totalCount > 0 && (
                <span className="text-xs text-ink4">
                  {displayIndex} of {totalCount}
                </span>
              )}
              <button
                disabled={!nextId}
                onClick={() => nextId && router.push(`/contacts/${nextId}`)}
                className={`text-xs transition-opacity ${!nextId ? 'text-ink4 opacity-40 cursor-not-allowed' : 'text-ink3 hover:text-ink2'}`}
              >
                Next →
              </button>
            </div>
          </div>

          {/* Contact identity (avatar + name + phone + email + edit button) */}
          <ContactHeader contact={headerContact} onSaved={() => fetchContactData()} />

          {/* Tags chips — G25c */}
          <div className="flex flex-wrap gap-1.5 mt-3 items-center">
            {tags.map((tag) => (
              <span
                key={tag}
                className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${tagColorClass(tag)}`}
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="ml-0.5 hover:opacity-60 leading-none"
                  aria-label={`Remove ${tag}`}
                >
                  &times;
                </button>
              </span>
            ))}
            {tags.length < 10 &&
              (addingTag ? (
                <div className="relative">
                  <input
                    type="text"
                    value={tagInput}
                    autoFocus
                    onChange={(e) => {
                      setTagInput(e.target.value)
                      setShowTagSuggestions(true)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addTag(tagInput)
                      }
                      if (e.key === 'Escape') {
                        setAddingTag(false)
                        setTagInput('')
                        setShowTagSuggestions(false)
                      }
                    }}
                    onBlur={() =>
                      setTimeout(() => {
                        setShowTagSuggestions(false)
                        if (!tagInput.trim()) setAddingTag(false)
                      }, 150)
                    }
                    placeholder="Add tag…"
                    className="text-xs border border-border-brand rounded-full px-2.5 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  {showTagSuggestions && filteredTagSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg z-20 min-w-[160px] max-h-36 overflow-y-auto">
                      {filteredTagSuggestions.slice(0, 6).map((s) => (
                        <button
                          key={s}
                          onMouseDown={() => addTag(s)}
                          className="block w-full text-left text-xs px-3 py-1.5 hover:bg-bg text-ink2"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setAddingTag(true)}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-0.5 rounded-full border border-dashed border-teal-300 hover:border-teal-400 transition-colors"
                >
                  + tag
                </button>
              ))}
          </div>

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setShowEmailModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-brand bg-white px-3 py-1.5 text-sm font-medium text-ink2 hover:bg-bg"
            >
              Send Email
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Enrichment banner */}
          {enrichmentSuggestion && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 flex items-center justify-between">
              <div>
                <span className="text-sm text-blue-800">Suggested company: </span>
                <span className="text-sm font-medium text-blue-900">{enrichmentSuggestion}</span>
                <span className="text-xs text-blue-600 ml-1">(from email domain)</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleLinkCompany()}
                  className="text-xs text-blue-700 hover:underline"
                >
                  Link
                </button>
                <button
                  onClick={() => void handleDismissEnrichment()}
                  className="text-xs text-ink3 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Add Note */}
          <AddNoteForm contactId={contactId} onNoteAdded={handleNoteAdded} />

          {/* Tasks */}
          <div className="bg-white rounded-xl border border-border-brand p-5">
            <ContactTasks contactId={contactId} />
          </div>

          {/* Deals */}
          <div className="bg-white rounded-xl border border-border-brand p-5">
            <ContactDeals contactId={contactId} />
          </div>

          {/* Activity tabs */}
          <div className="bg-white rounded-xl border border-border-brand">
            <div className="flex border-b border-border-brand">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key)
                    if (tab.key === 'messages') setSmsUnread(0)
                  }}
                  className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                    activeTab === tab.key
                      ? 'text-teal-700 border-b-2 border-teal-600'
                      : 'text-ink3 hover:text-ink2'
                  }`}
                >
                  {tab.label}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        tab.key === 'messages' ? 'bg-red-500 text-white' : 'bg-bg3 text-ink3'
                      }`}
                    >
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div>
              {activeTab === 'activity' && (
                <ActivityTimeline contactId={contactId} refreshKey={refreshKey} />
              )}
              {activeTab === 'messages' && (
                <SmsThread contactId={contactId} contactName={contactName} />
              )}
              {activeTab === 'files' && <FileAttachments contactId={contactId} />}
            </div>
          </div>
        </div>

        {/* ── G25e — Compose bar (sticky bottom) ── */}
        <div className="shrink-0 bg-white border-t border-border-brand px-4 py-3">
          {/* Tabs */}
          <div className="flex gap-4 mb-2">
            {(['sms', 'note'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setComposeTab(t)}
                className={`text-xs font-medium pb-1 transition-colors ${
                  composeTab === t
                    ? 'text-teal-700 border-b-2 border-teal-600'
                    : 'text-ink4 hover:text-ink3'
                }`}
              >
                {t === 'sms' ? 'SMS' : 'Internal Note'}
              </button>
            ))}
          </div>

          {composeTab === 'sms' && (
            <div>
              <textarea
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
                rows={2}
                placeholder="Send a message…"
                className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] font-medium ${
                      smsText.length >= 160
                        ? 'text-red-600'
                        : smsText.length >= 140
                          ? 'text-amber-600'
                          : 'text-ink4'
                    }`}
                  >
                    {smsText.length} / 160
                  </span>
                  {smsText.length >= 160 && (
                    <span className="text-[11px] text-ink4">
                      {Math.ceil(smsText.length / 160)} segment
                      {Math.ceil(smsText.length / 160) > 1 ? 's' : ''}
                    </span>
                  )}
                  {!smsOptIn && (
                    <span className="text-[11px] text-rose-500 font-medium">SMS opted out</span>
                  )}
                </div>
                <button
                  onClick={() => void handleSendSms()}
                  disabled={smsSending || !smsText.trim() || !headerContact.phone || !smsOptIn}
                  className="px-3 py-1 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {smsSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}

          {composeTab === 'note' && (
            <div>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                placeholder="Add an internal note…"
                className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <div className="flex justify-end mt-1.5">
                <button
                  onClick={() => void handleSaveNote()}
                  disabled={noteSaving || !noteText.trim()}
                  className="px-3 py-1 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {noteSaving ? 'Saving…' : 'Save Note'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL — 56px icon rail + expandable content ── */}
      <div className="flex flex-shrink-0">
        {/* Expandable content panel */}
        {activePanel && (
          <div className="w-72 border-l border-border-brand overflow-y-auto bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-border-brand flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold text-ink2">
                {RAIL_ICONS.find((i) => i.key === activePanel)?.label}
              </span>
              <button
                onClick={() => setActivePanel(null)}
                className="text-ink4 hover:text-ink3 text-lg leading-none"
                aria-label="Close panel"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderRightPanelContent()}</div>
          </div>
        )}

        {/* Icon rail */}
        <div className="w-14 flex flex-col items-center py-4 gap-1 bg-white border-l border-border-brand">
          {RAIL_ICONS.map(({ key, label, Icon }) => (
            <button
              key={key}
              title={label}
              onClick={() => togglePanel(key)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                activePanel === key
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-ink3 hover:bg-bg2 hover:text-ink2'
              }`}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>

      {/* Email compose modal */}
      {showEmailModal && (
        <EmailComposeModal
          contactId={contactId}
          contactEmail={headerContact.email ?? ''}
          contactName={contactName}
          onClose={() => setShowEmailModal(false)}
          onSent={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}
