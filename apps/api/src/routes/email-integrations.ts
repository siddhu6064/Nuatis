import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { encryptToken, getValidToken } from '../lib/email-oauth.js'
import {
  buildMimeMessage,
  injectTrackingPixel,
  sendViaGmail,
  sendViaOutlook,
} from '../lib/email-send.js'
import { logActivity } from '../lib/activity.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET / — list connected email accounts ────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('user_email_accounts')
    .select('id, provider, email_address, is_default, created_at')
    .eq('tenant_id', authed.tenantId)
    .eq('user_id', authed.userId)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ accounts: data ?? [] })
})

// ── DELETE /:id — disconnect account ─────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getSupabase()

  // Verify the account belongs to the current user before deleting
  const { data: existing, error: fetchError } = await supabase
    .from('user_email_accounts')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .eq('user_id', authed.userId)
    .single()

  if (fetchError || !existing) {
    res.status(404).json({ error: 'Email account not found' })
    return
  }

  const { error } = await supabase.from('user_email_accounts').delete().eq('id', id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

// ── GET /gmail/auth-url — generate Gmail OAuth consent URL ───────────────────
router.get('/gmail/auth-url', requireAuth, (req: Request, res: Response): void => {
  const authed = req as AuthenticatedRequest

  const clientId = process.env['GOOGLE_EMAIL_CLIENT_ID']
  if (!clientId) {
    res.status(500).json({ error: 'GOOGLE_EMAIL_CLIENT_ID not set' })
    return
  }

  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const redirectUri = `${apiUrl}/api/email-integrations/gmail/callback`

  const state = Buffer.from(JSON.stringify({ tenantId: authed.tenantId, userId: authed.userId }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  res.json({ url: authUrl })
})

// ── GET /gmail/callback — Gmail OAuth callback (NO requireAuth) ───────────────
router.get('/gmail/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error: oauthError } = req.query as Record<string, string>
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'

  if (oauthError || !code || !state) {
    res.redirect(
      `${webUrl}/settings/integrations?email=error&reason=${oauthError ?? 'missing_params'}`
    )
    return
  }

  let tenantId: string
  let userId: string

  try {
    const decoded = Buffer.from(state.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf-8'
    )
    const parsed = JSON.parse(decoded) as { tenantId: string; userId: string }
    tenantId = parsed.tenantId
    userId = parsed.userId
  } catch {
    res.redirect(`${webUrl}/settings/integrations?email=error&reason=invalid_state`)
    return
  }

  try {
    const clientId = process.env['GOOGLE_EMAIL_CLIENT_ID']
    const clientSecret = process.env['GOOGLE_EMAIL_CLIENT_SECRET']
    if (!clientId || !clientSecret) throw new Error('Google OAuth env vars not set')

    const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
    const redirectUri = `${apiUrl}/api/email-integrations/gmail/callback`

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    if (!tokens.refresh_token) {
      throw new Error('No refresh token returned — ensure prompt=consent was set')
    }

    // Fetch user email via userinfo
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userinfoRes.ok) {
      throw new Error(`Failed to fetch user email: ${userinfoRes.status}`)
    }

    const userInfo = (await userinfoRes.json()) as { email: string }
    const emailAddress = userInfo.email

    const encryptedAccess = encryptToken(tokens.access_token)
    const encryptedRefresh = encryptToken(tokens.refresh_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const supabase = getSupabase()

    // Check if this user already has any accounts (to determine is_default)
    const { data: existingAccounts } = await supabase
      .from('user_email_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)

    const isDefault = !existingAccounts || existingAccounts.length === 0

    const { error: upsertError } = await supabase.from('user_email_accounts').upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        provider: 'gmail',
        email_address: emailAddress,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: expiresAt,
        is_default: isDefault,
      },
      { onConflict: 'tenant_id,email_address' }
    )

    if (upsertError) throw new Error(`DB upsert failed: ${upsertError.message}`)

    res.redirect(`${webUrl}/settings/integrations?email=connected`)
  } catch (err) {
    console.error('[email-integrations] Gmail callback error:', err)
    res.redirect(`${webUrl}/settings/integrations?email=error&reason=server_error`)
  }
})

// ── GET /outlook/auth-url — generate Outlook OAuth consent URL ───────────────
router.get('/outlook/auth-url', requireAuth, (req: Request, res: Response): void => {
  const authed = req as AuthenticatedRequest

  const clientId = process.env['OUTLOOK_CLIENT_ID']
  if (!clientId) {
    res.status(500).json({ error: 'OUTLOOK_CLIENT_ID not set' })
    return
  }

  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
  const redirectUri = `${apiUrl}/api/email-integrations/outlook/callback`

  const state = Buffer.from(JSON.stringify({ tenantId: authed.tenantId, userId: authed.userId }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'Mail.Send Mail.Read User.Read offline_access',
    response_mode: 'query',
    state,
  })

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  res.json({ url: authUrl })
})

// ── GET /outlook/callback — Outlook OAuth callback (NO requireAuth) ───────────
router.get('/outlook/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error: oauthError } = req.query as Record<string, string>
  const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'

  if (oauthError || !code || !state) {
    res.redirect(
      `${webUrl}/settings/integrations?email=error&reason=${oauthError ?? 'missing_params'}`
    )
    return
  }

  let tenantId: string
  let userId: string

  try {
    const decoded = Buffer.from(state.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf-8'
    )
    const parsed = JSON.parse(decoded) as { tenantId: string; userId: string }
    tenantId = parsed.tenantId
    userId = parsed.userId
  } catch {
    res.redirect(`${webUrl}/settings/integrations?email=error&reason=invalid_state`)
    return
  }

  try {
    const clientId = process.env['OUTLOOK_CLIENT_ID']
    const clientSecret = process.env['OUTLOOK_CLIENT_SECRET']
    if (!clientId || !clientSecret) throw new Error('Outlook OAuth env vars not set')

    const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
    const redirectUri = `${apiUrl}/api/email-integrations/outlook/callback`

    // Exchange code for tokens at Microsoft token endpoint
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'Mail.Send Mail.Read User.Read offline_access',
      }).toString(),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      throw new Error(`Outlook token exchange failed: ${tokenRes.status} ${text}`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    if (!tokens.refresh_token) {
      throw new Error('No refresh token returned from Outlook')
    }

    // Fetch user email via Graph /me
    const meRes = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    )

    if (!meRes.ok) {
      throw new Error(`Failed to fetch Outlook user email: ${meRes.status}`)
    }

    const meData = (await meRes.json()) as { mail?: string; userPrincipalName?: string }
    const emailAddress = meData.mail ?? meData.userPrincipalName ?? ''

    if (!emailAddress) {
      throw new Error('Could not determine email address from Outlook account')
    }

    const encryptedAccess = encryptToken(tokens.access_token)
    const encryptedRefresh = encryptToken(tokens.refresh_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const supabase = getSupabase()

    // Check if this user already has any accounts (to determine is_default)
    const { data: existingAccounts } = await supabase
      .from('user_email_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)

    const isDefault = !existingAccounts || existingAccounts.length === 0

    const { error: upsertError } = await supabase.from('user_email_accounts').upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        provider: 'outlook',
        email_address: emailAddress,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: expiresAt,
        is_default: isDefault,
      },
      { onConflict: 'tenant_id,email_address' }
    )

    if (upsertError) throw new Error(`DB upsert failed: ${upsertError.message}`)

    res.redirect(`${webUrl}/settings/integrations?email=connected`)
  } catch (err) {
    console.error('[email-integrations] Outlook callback error:', err)
    res.redirect(`${webUrl}/settings/integrations?email=error&reason=server_error`)
  }
})

// ── POST /send/:contactId — send email to a contact ─────────────────────────
router.post('/send/:contactId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { contactId } = req.params as { contactId: string }

  const { subject, bodyHtml, bodyText, emailAccountId, templateId } = req.body as {
    subject: string
    bodyHtml: string
    bodyText: string
    emailAccountId: string
    templateId?: string
  }

  if (!subject || !bodyHtml || !emailAccountId) {
    res.status(400).json({ error: 'subject, bodyHtml, and emailAccountId are required' })
    return
  }

  const supabase = getSupabase()

  // Validate contact exists and has an email address
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id, email, full_name')
    .eq('id', contactId)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (contactError || !contact) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  if (!contact.email) {
    res.status(422).json({ error: 'Contact has no email address' })
    return
  }

  // Validate email account belongs to the current user
  const { data: emailAccount, error: accountError } = await supabase
    .from('user_email_accounts')
    .select('id, provider, email_address')
    .eq('id', emailAccountId)
    .eq('tenant_id', authed.tenantId)
    .eq('user_id', authed.userId)
    .single()

  if (accountError || !emailAccount) {
    res.status(404).json({ error: 'Email account not found' })
    return
  }

  try {
    // Get a valid (possibly refreshed) access token
    const { accessToken, provider } = await getValidToken(emailAccountId)

    // Generate a tracking token for the pixel
    const trackingToken = crypto.randomUUID()
    const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'

    // Inject tracking pixel into HTML body
    const trackedHtml = injectTrackingPixel(bodyHtml, trackingToken, apiUrl)
    const plainText = bodyText ?? ''

    const providerMessageId: string | null = null

    if (provider === 'gmail') {
      const rawMessage = buildMimeMessage(
        emailAccount.email_address,
        contact.email as string,
        subject,
        trackedHtml,
        plainText
      )
      await sendViaGmail(accessToken, rawMessage)
    } else {
      await sendViaOutlook(accessToken, contact.email as string, subject, trackedHtml, plainText)
    }

    // Insert email_messages record
    const { data: inserted, error: insertError } = await supabase
      .from('email_messages')
      .insert({
        tenant_id: authed.tenantId,
        contact_id: contactId,
        email_account_id: emailAccountId,
        template_id: templateId ?? null,
        direction: 'outbound',
        subject,
        body_html: trackedHtml,
        body_text: plainText,
        tracking_token: trackingToken,
        provider_message_id: providerMessageId,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError) {
      console.error(
        '[email-integrations] Failed to insert email_messages record:',
        insertError.message
      )
    }

    // Log the activity
    await logActivity({
      tenantId: authed.tenantId,
      contactId,
      type: 'email',
      body: `Sent email: ${subject}`,
      metadata: { direction: 'outbound', email_message_id: inserted?.id },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json({ success: true, messageId: inserted?.id ?? null })
  } catch (err) {
    console.error('[email-integrations] Send error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send email' })
  }
})

export default router
