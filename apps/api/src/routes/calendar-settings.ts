import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { encryptToken } from '../lib/email-oauth.js'
import { getOutlookCalendarAuthUrl, exchangeOutlookCalendarCode } from '../lib/outlook-calendar.js'

// ── DB helper ─────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Compliance field definitions ──────────────────────────────────────────────

const COMPLIANCE_FIELDS: Record<
  string,
  Array<{
    key: string
    label: string
    type: 'boolean' | 'boolean_with_date' | 'boolean_with_notes'
    required: boolean
  }>
> = {
  dental: [
    {
      key: 'hipaa_consent_signed',
      label: 'HIPAA Consent Signed',
      type: 'boolean_with_date',
      required: true,
    },
    {
      key: 'insurance_verified',
      label: 'Insurance Verified',
      type: 'boolean',
      required: false,
    },
    {
      key: 'medical_history_reviewed',
      label: 'Medical History Reviewed',
      type: 'boolean_with_date',
      required: false,
    },
  ],
  law_firm: [
    {
      key: 'conflict_of_interest_checked',
      label: 'Conflict of Interest Checked',
      type: 'boolean_with_notes',
      required: true,
    },
    {
      key: 'engagement_letter_signed',
      label: 'Engagement Letter Signed',
      type: 'boolean_with_date',
      required: true,
    },
    {
      key: 'retainer_received',
      label: 'Retainer Received',
      type: 'boolean',
      required: false,
    },
  ],
  contractor: [
    {
      key: 'liability_waiver_signed',
      label: 'Liability Waiver Signed',
      type: 'boolean_with_date',
      required: false,
    },
    {
      key: 'permit_verified',
      label: 'Building Permit Verified',
      type: 'boolean',
      required: false,
    },
  ],
  real_estate: [
    {
      key: 'agency_disclosure_signed',
      label: 'Agency Disclosure Signed',
      type: 'boolean_with_date',
      required: true,
    },
    {
      key: 'pre_approval_verified',
      label: 'Pre-Approval Verified',
      type: 'boolean',
      required: false,
    },
    {
      key: 'fair_housing_acknowledged',
      label: 'Fair Housing Acknowledged',
      type: 'boolean_with_date',
      required: false,
    },
  ],
  salon: [
    {
      key: 'allergy_form_signed',
      label: 'Allergy/Sensitivity Form Signed',
      type: 'boolean_with_date',
      required: false,
    },
    {
      key: 'photo_consent',
      label: 'Photo/Social Media Consent',
      type: 'boolean',
      required: false,
    },
  ],
  sales_crm: [
    {
      key: 'nda_signed',
      label: 'NDA Signed',
      type: 'boolean_with_date',
      required: false,
    },
    {
      key: 'data_processing_consent',
      label: 'Data Processing Consent',
      type: 'boolean_with_date',
      required: false,
    },
  ],
}

// ── calendarSettingsRouter (requireAuth) ──────────────────────────────────────

const calendarSettingsRouter = Router()

// GET / — return calendar connection status
calendarSettingsRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const [tenantResult, locationResult] = await Promise.all([
    supabase
      .from('tenants')
      .select('calendar_provider, outlook_calendar_email')
      .eq('id', authed.tenantId)
      .single(),
    supabase
      .from('locations')
      .select('google_calendar_id')
      .eq('tenant_id', authed.tenantId)
      .not('google_calendar_id', 'is', null)
      .limit(1),
  ])

  if (tenantResult.error || !tenantResult.data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const tenant = tenantResult.data as {
    calendar_provider: string | null
    outlook_calendar_email: string | null
  }

  // Detect legacy Google connection via location google_calendar_id
  const hasGoogleLegacy =
    !locationResult.error && locationResult.data != null && locationResult.data.length > 0

  let provider: 'google' | 'outlook' | null = null
  let email: string | null = null
  let connected = false

  if (tenant.calendar_provider === 'outlook') {
    provider = 'outlook'
    email = tenant.outlook_calendar_email ?? null
    connected = true
  } else if (tenant.calendar_provider === 'google' || hasGoogleLegacy) {
    provider = 'google'
    email = null // Google email not stored on our end
    connected = true
  }

  res.json({ provider, email, connected })
})

// GET /outlook/auth-url — generate Outlook Calendar OAuth URL
calendarSettingsRouter.get(
  '/outlook/auth-url',
  requireAuth,
  (req: Request, res: Response): void => {
    const authed = req as AuthenticatedRequest

    const clientId = process.env['OUTLOOK_CLIENT_ID']
    if (!clientId) {
      res.status(500).json({ error: 'OUTLOOK_CLIENT_ID not set' })
      return
    }

    try {
      const url = getOutlookCalendarAuthUrl(authed.tenantId)
      res.json({ url })
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : 'Failed to generate auth URL' })
    }
  }
)

// DELETE /outlook — disconnect Outlook calendar
calendarSettingsRouter.delete(
  '/outlook',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { error } = await supabase
      .from('tenants')
      .update({
        calendar_provider: null,
        outlook_calendar_access_token: null,
        outlook_calendar_refresh_token: null,
        outlook_calendar_token_expires_at: null,
        outlook_calendar_email: null,
      })
      .eq('id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ success: true })
  }
)

// GET /compliance-fields — return compliance field definitions for tenant's vertical
calendarSettingsRouter.get(
  '/compliance-fields',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('vertical')
      .eq('id', authed.tenantId)
      .single()

    if (error || !tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    const vertical = (tenant as { vertical: string | null }).vertical ?? ''
    const fields = COMPLIANCE_FIELDS[vertical] ?? []

    res.json({ vertical, fields })
  }
)

// ── calendarCallbackRouter (PUBLIC, no auth) ──────────────────────────────────

const calendarCallbackRouter = Router()

// GET /outlook/callback — Outlook OAuth callback (browser redirect from Microsoft)
calendarCallbackRouter.get(
  '/outlook/callback',
  async (req: Request, res: Response): Promise<void> => {
    const { code, state, error: oauthError } = req.query as Record<string, string>
    const webUrl = process.env['WEB_URL'] || 'http://localhost:3000'

    if (oauthError || !code || !state) {
      res.redirect(`${webUrl}/settings/calendar?error=${oauthError ?? 'missing_params'}`)
      return
    }

    let tenantId: string

    try {
      const decoded = Buffer.from(state.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf-8'
      )
      const parsed = JSON.parse(decoded) as { tenantId: string }
      tenantId = parsed.tenantId
    } catch {
      res.redirect(`${webUrl}/settings/calendar?error=invalid_state`)
      return
    }

    try {
      const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
      const redirectUri = `${apiUrl}/api/calendar/outlook/callback`

      // Exchange code for tokens
      const tokens = await exchangeOutlookCalendarCode(code, redirectUri)

      if (!tokens.refresh_token) {
        throw new Error('No refresh token returned from Outlook Calendar OAuth')
      }

      // Fetch user email via Graph /me
      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })

      if (!meRes.ok) {
        throw new Error(`Failed to fetch Outlook user info: ${meRes.status}`)
      }

      const meData = (await meRes.json()) as { mail?: string; userPrincipalName?: string }
      const calendarEmail = meData.mail ?? meData.userPrincipalName ?? null

      // Encrypt tokens before storing
      const encryptedAccessToken = encryptToken(tokens.access_token)
      const encryptedRefreshToken = encryptToken(tokens.refresh_token)
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

      const supabase = getSupabase()

      const { error: updateError } = await supabase
        .from('tenants')
        .update({
          calendar_provider: 'outlook',
          outlook_calendar_access_token: encryptedAccessToken,
          outlook_calendar_refresh_token: encryptedRefreshToken,
          outlook_calendar_token_expires_at: expiresAt,
          outlook_calendar_email: calendarEmail,
        })
        .eq('id', tenantId)

      if (updateError) {
        throw new Error(`Failed to save Outlook Calendar tokens: ${updateError.message}`)
      }

      res.redirect(`${webUrl}/settings/calendar?connected=outlook`)
    } catch (err) {
      console.error('[calendar-settings] Outlook callback error:', err)
      res.redirect(`${webUrl}/settings/calendar?error=server_error`)
    }
  }
)

export { calendarCallbackRouter }
export default calendarSettingsRouter
