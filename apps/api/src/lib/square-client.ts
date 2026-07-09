import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Environment / helpers
// ---------------------------------------------------------------------------

const SQUARE_ENVIRONMENT = process.env['SQUARE_ENVIRONMENT'] ?? 'sandbox'
const SQUARE_APP_ID = process.env['SQUARE_APP_ID'] ?? ''
const SQUARE_APP_SECRET = process.env['SQUARE_APP_SECRET'] ?? ''

function squareBaseUrl(): string {
  return SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function maybeRefreshToken(connection: {
  id: string
  access_token: string
  refresh_token: string
  token_expires_at: string | null
}): Promise<string> {
  const supabase = getSupabase()

  // Refresh proactively if token expires within 7 days
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at) : null

  if (expiresAt && expiresAt < sevenDaysFromNow) {
    const refreshRes = await fetch(`${squareBaseUrl()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        grant_type: 'refresh_token',
        refresh_token: connection.refresh_token,
      }),
    })

    if (!refreshRes.ok) {
      const body = await refreshRes.text()
      throw new Error(`Square token refresh failed: ${body}`)
    }

    const refreshData = (await refreshRes.json()) as {
      access_token: string
      refresh_token: string
      expires_at: string
    }

    const { error: updateError } = await supabase
      .from('square_connections')
      .update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        token_expires_at: refreshData.expires_at,
      })
      .eq('id', connection.id)

    if (updateError) throw new Error(`Failed to update Square tokens: ${updateError.message}`)

    return refreshData.access_token
  }

  return connection.access_token
}

// ---------------------------------------------------------------------------
// Public: createSquarePayment
// ---------------------------------------------------------------------------

export async function createSquarePayment(params: {
  tenantId: string
  amountCents: number
  currency: string
  sourceId: string
  note?: string
  referenceId?: string
  idempotencyKey?: string
}): Promise<{ paymentId: string; status: string; receiptUrl: string | null }> {
  const supabase = getSupabase()

  const { data: connection, error } = await supabase
    .from('square_connections')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('tenant_id', params.tenantId)
    .single()

  if (error || !connection) {
    throw new Error(`No Square connection found for tenant ${params.tenantId}`)
  }

  const accessToken = await maybeRefreshToken(connection)

  const paymentRes = await fetch(`${squareBaseUrl()}/v2/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': '2024-01-18',
    },
    body: JSON.stringify({
      idempotency_key: params.idempotencyKey ?? randomUUID(),
      amount_money: {
        amount: params.amountCents,
        currency: params.currency,
      },
      source_id: params.sourceId,
      ...(params.note !== undefined && { note: params.note }),
      ...(params.referenceId !== undefined && { reference_id: params.referenceId }),
    }),
  })

  const paymentData = (await paymentRes.json()) as {
    payment?: {
      id: string
      status: string
      receipt_url?: string
    }
    errors?: Array<{ detail?: string }>
  }

  if (!paymentRes.ok) {
    throw new Error(
      `Square payment failed: ${paymentData.errors?.[0]?.detail ?? paymentRes.statusText}`
    )
  }

  const payment = paymentData.payment!
  return {
    paymentId: payment.id,
    status: payment.status,
    receiptUrl: payment.receipt_url ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public: getSquarePayment
// ---------------------------------------------------------------------------

export async function getSquarePayment(
  tenantId: string,
  paymentId: string
): Promise<{
  paymentId: string
  status: string
  receiptUrl: string | null
  amountCents: number
  currency: string
}> {
  const supabase = getSupabase()

  const { data: connection, error } = await supabase
    .from('square_connections')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('tenant_id', tenantId)
    .single()

  if (error || !connection) {
    throw new Error(`No Square connection found for tenant ${tenantId}`)
  }

  const accessToken = await maybeRefreshToken(connection)

  const res = await fetch(`${squareBaseUrl()}/v2/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': '2024-01-18',
    },
  })

  const data = (await res.json()) as {
    payment?: {
      id: string
      status: string
      receipt_url?: string
      amount_money?: { amount?: number; currency?: string }
    }
    errors?: Array<{ detail?: string }>
  }

  if (!res.ok) {
    throw new Error(`Square get payment failed: ${data.errors?.[0]?.detail ?? res.statusText}`)
  }

  const payment = data.payment!
  return {
    paymentId: payment.id,
    status: payment.status,
    receiptUrl: payment.receipt_url ?? null,
    amountCents: payment.amount_money?.amount ?? 0,
    currency: payment.amount_money?.currency ?? '',
  }
}
