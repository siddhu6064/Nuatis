import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmailAccount {
  id: string
  provider: 'gmail' | 'outlook'
  access_token: string
  refresh_token: string
  token_expires_at: string
}

export interface ValidToken {
  accessToken: string
  provider: 'gmail' | 'outlook'
}

// ── DB helper ────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Encryption ───────────────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypt.
 * Returns iv:ciphertext:authTag as colon-delimited hex string.
 */
export function encryptToken(plaintext: string): string {
  const secret = process.env['EMAIL_TOKEN_SECRET']
  if (!secret) throw new Error('EMAIL_TOKEN_SECRET not set')

  const key = Buffer.from(secret, 'hex')
  if (key.length !== 32)
    throw new Error('EMAIL_TOKEN_SECRET must be a 32-byte hex string (64 hex chars)')

  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('hex'), ciphertext.toString('hex'), authTag.toString('hex')].join(':')
}

/**
 * AES-256-GCM decrypt.
 * Accepts iv:ciphertext:authTag colon-delimited hex string.
 */
export function decryptToken(encrypted: string): string {
  const secret = process.env['EMAIL_TOKEN_SECRET']
  if (!secret) throw new Error('EMAIL_TOKEN_SECRET not set')

  const key = Buffer.from(secret, 'hex')
  if (key.length !== 32)
    throw new Error('EMAIL_TOKEN_SECRET must be a 32-byte hex string (64 hex chars)')

  const parts = encrypted.split(':')
  if (parts.length !== 3)
    throw new Error('Invalid encrypted token format; expected iv:ciphertext:authTag')

  const [ivHex, ciphertextHex, authTagHex] = parts as [string, string, string]
  const iv = Buffer.from(ivHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

// ── Token refresh ─────────────────────────────────────────────────────────────

/**
 * Refresh a Gmail access token using the stored refresh_token.
 * Updates access_token and token_expires_at in the DB.
 */
export async function refreshGmailToken(account: EmailAccount): Promise<string> {
  const clientId = process.env['GOOGLE_EMAIL_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_EMAIL_CLIENT_SECRET']
  if (!clientId || !clientSecret) throw new Error('Google email OAuth env vars not set')

  const refreshToken = decryptToken(account.refresh_token)

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail token refresh failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  const encryptedAccessToken = encryptToken(data.access_token)

  const supabase = getSupabase()
  const { error } = await supabase
    .from('email_accounts')
    .update({ access_token: encryptedAccessToken, token_expires_at: expiresAt })
    .eq('id', account.id)

  if (error) throw new Error(`Failed to update Gmail token in DB: ${error.message}`)

  console.info(`[email-oauth] refreshed Gmail token for account=${account.id}`)
  return data.access_token
}

/**
 * Refresh an Outlook access token using the stored refresh_token.
 * Updates access_token and token_expires_at in the DB.
 */
export async function refreshOutlookToken(account: EmailAccount): Promise<string> {
  const clientId = process.env['OUTLOOK_CLIENT_ID']
  const clientSecret = process.env['OUTLOOK_CLIENT_SECRET']
  if (!clientId || !clientSecret) throw new Error('Outlook OAuth env vars not set')

  const refreshToken = decryptToken(account.refresh_token)

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope:
      'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access',
  })

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook token refresh failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  const encryptedAccessToken = encryptToken(data.access_token)

  const supabase = getSupabase()
  const { error } = await supabase
    .from('email_accounts')
    .update({ access_token: encryptedAccessToken, token_expires_at: expiresAt })
    .eq('id', account.id)

  if (error) throw new Error(`Failed to update Outlook token in DB: ${error.message}`)

  console.info(`[email-oauth] refreshed Outlook token for account=${account.id}`)
  return data.access_token
}

// ── getValidToken ─────────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch the email account from DB, decrypt tokens, auto-refresh if within
 * 5 minutes of expiry, and return a valid decrypted access_token + provider.
 */
export async function getValidToken(accountId: string): Promise<ValidToken> {
  const supabase = getSupabase()

  const { data: account, error } = await supabase
    .from('email_accounts')
    .select('id, provider, access_token, refresh_token, token_expires_at')
    .eq('id', accountId)
    .single()

  if (error || !account) {
    throw new Error(`Email account not found: ${accountId}`)
  }

  const emailAccount = account as EmailAccount

  const expiresAt = new Date(emailAccount.token_expires_at).getTime()
  const now = Date.now()
  const needsRefresh = expiresAt - now <= REFRESH_BUFFER_MS

  let accessToken: string

  if (needsRefresh) {
    console.info(`[email-oauth] token expiring soon for account=${accountId}, refreshing…`)
    if (emailAccount.provider === 'gmail') {
      accessToken = await refreshGmailToken(emailAccount)
    } else {
      accessToken = await refreshOutlookToken(emailAccount)
    }
  } else {
    accessToken = decryptToken(emailAccount.access_token)
  }

  return { accessToken, provider: emailAccount.provider }
}
