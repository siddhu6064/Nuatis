import { createClient } from '@supabase/supabase-js'
import { API_BASE_URL } from '../config/urls.js'
import { registerOutboundCall } from '../voice/telnyx-handler.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export interface OutboundCallParams {
  tenantId: string
  contactId: string
  jobId: string
  toNumber: string // E.164 format: +15125551234
  fromNumber: string // E.164 format, from locations.telnyx_number
  callContext: string // what Maya should say / purpose of call
}

export interface OutboundCallResult {
  callControlId: string
  callLegId: string
}

export async function initiateOutboundCall(
  params: OutboundCallParams
): Promise<OutboundCallResult> {
  const { tenantId, contactId, jobId, toNumber, fromNumber, callContext } = params

  const apiKey = process.env['TELNYX_API_KEY'] ?? ''
  const connectionId = process.env['TELNYX_CONNECTION_ID'] ?? ''

  if (!apiKey) {
    console.error('[outbound-caller] TELNYX_API_KEY missing or empty — cannot initiate call')
    throw new Error('TELNYX_API_KEY not configured')
  }
  if (!connectionId) {
    console.error('[outbound-caller] TELNYX_CONNECTION_ID missing or empty — cannot initiate call')
    throw new Error('TELNYX_CONNECTION_ID not configured')
  }

  const webhookUrl = `${API_BASE_URL}/voice/outbound-status`

  const payload = {
    connection_id: connectionId,
    to: toNumber,
    from: fromNumber,
    webhook_url: webhookUrl,
    custom_headers: [
      { name: 'X-Tenant-Id', value: tenantId },
      { name: 'X-Contact-Id', value: contactId },
      { name: 'X-Job-Id', value: jobId },
      { name: 'X-Call-Type', value: 'outbound' },
      { name: 'X-Call-Context', value: callContext },
    ],
  }

  console.info(`[outbound-caller] posting to Telnyx: job=${jobId} tenant=${tenantId}`)

  // POST to Telnyx to initiate the call — 15s timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    console.error('[outbound-caller] fetch to Telnyx timed out after 15s — aborting')
    controller.abort()
  }, 15000)

  let res: Response
  try {
    res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
    console.error(`[outbound-caller] fetch threw (network/timeout): ${msg}`, fetchErr)
    throw fetchErr
  } finally {
    clearTimeout(timeoutId)
  }

  console.info(`[outbound-caller] Telnyx HTTP status: ${res.status}`)

  if (!res.ok) {
    const body = await res.text()
    console.error(
      `[outbound-caller] Telnyx error ${res.status}: ${body} | job=${jobId} connection_id=${connectionId}`
    )
    throw new Error(`Telnyx API error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    data: {
      call_control_id: string
      call_leg_id: string
    }
  }

  console.info(
    `[outbound-caller] Telnyx accepted call: call_control_id=${data.data.call_control_id} call_leg_id=${data.data.call_leg_id}`
  )

  const callControlId = data.data.call_control_id
  const callLegId = data.data.call_leg_id

  // Register metadata so the WS handler can identify this as an outbound call
  registerOutboundCall(callControlId, {
    tenantId,
    contactId,
    jobId,
    contactName: null,
    callContext,
  })

  // Update outbound_call_jobs to 'dialing'
  const supabase = getSupabase()
  await supabase
    .from('outbound_call_jobs')
    .update({ status: 'dialing', started_at: new Date().toISOString() })
    .eq('id', jobId)

  console.info(`[outbound-caller] initiated call: job=${jobId} callControlId=${callControlId}`)

  return { callControlId, callLegId }
}
