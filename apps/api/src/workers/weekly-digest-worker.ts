import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { buildDigestData } from '../lib/digest-builder.js'
import { renderWeeklyDigest } from '../lib/email-templates/weekly-digest.js'
import { sendEmail } from '../lib/email-client.js'
import { signDigestToken } from '../routes/digest.js'

const QUEUE_NAME = 'weekly-digest'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/** First char + domain only — owner emails must not land in logs verbatim. */
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? `${email[0]}***@${email.slice(at + 1)}` : '***'
}

async function processWeeklyDigest(): Promise<void> {
  console.info('[weekly-digest] starting weekly digest scan...')

  const supabase = getSupabase()

  const sixDaysAgoIso = new Date(Date.now() - 6 * 86400000).toISOString()

  // 1. Fetch all eligible tenants
  const { data: tenants, error: tenantsErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('digest_enabled', true)
    .or(`digest_last_sent_at.is.null,digest_last_sent_at.lt.${sixDaysAgoIso}`)

  if (tenantsErr) {
    console.error(`[weekly-digest] tenants query error: ${tenantsErr.message}`)
    return
  }

  const eligibleTenants = tenants ?? []
  let sent = 0
  let failed = 0

  // 2. Process each tenant sequentially to avoid hammering the email API
  for (const tenant of eligibleTenants) {
    try {
      // a. Get owner email
      const { data: ownerRows, error: ownerErr } = await supabase
        .from('users')
        .select('email')
        .eq('tenant_id', tenant.id)
        .eq('role', 'owner')
        .limit(1)

      if (ownerErr) {
        console.warn(
          `[weekly-digest] owner query error tenant=${tenant.id}: ${ownerErr.message} — skipping`
        )
        failed++
        continue
      }

      const ownerEmail = ownerRows?.[0]?.email as string | undefined

      // b. Skip if no owner email
      if (!ownerEmail) {
        console.warn(`[weekly-digest] no owner found for tenant=${tenant.id} — skipping`)
        failed++
        continue
      }

      // c. Build digest data
      let data
      try {
        data = await buildDigestData(tenant.id)
      } catch (buildErr) {
        console.error(
          `[weekly-digest] buildDigestData error tenant=${tenant.id}:`,
          buildErr,
          '— skipping'
        )
        failed++
        continue
      }

      // d. Generate unsubscribe token
      const unsubToken = signDigestToken(tenant.id)

      // e. Render email HTML
      const { subject, html } = renderWeeklyDigest(data, unsubToken)

      // f. Send email
      let emailOk: boolean
      try {
        emailOk = await sendEmail({ to: ownerEmail, subject, html, tenantId: tenant.id })
      } catch (sendErr) {
        console.warn(
          `[weekly-digest] sendEmail threw for tenant=${tenant.id} email=${maskEmail(ownerEmail)}:`,
          sendErr,
          '— continuing'
        )
        failed++
        continue
      }

      // g. On sendEmail failure: log warn + continue
      if (!emailOk) {
        console.warn(
          `[weekly-digest] sendEmail returned false for tenant=${tenant.id} email=${maskEmail(ownerEmail)} — continuing`
        )
        failed++
        continue
      }

      // h. Update digest_last_sent_at AFTER successful send
      const { error: updateErr } = await supabase
        .from('tenants')
        .update({ digest_last_sent_at: new Date().toISOString() })
        .eq('id', tenant.id)

      if (updateErr) {
        console.warn(
          `[weekly-digest] failed to update digest_last_sent_at for tenant=${tenant.id}: ${updateErr.message}`
        )
      }

      // i. Log success
      console.info(`[weekly-digest] sent to tenantId=${tenant.id} email=${maskEmail(ownerEmail)}`)
      sent++
    } catch (tenantErr) {
      console.error(`[weekly-digest] unexpected error for tenant=${tenant.id}:`, tenantErr)
      failed++
    }
  }

  // 3. Log summary
  console.info(
    `[weekly-digest] processed ${eligibleTenants.length} tenants, ${sent} sent, ${failed} skipped`
  )
}

export function createWeeklyDigestWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => processWeeklyDigest(), {
    connection,
    skipVersionCheck: true,
  })

  worker.on('failed', (job, err) => {
    console.error(`[weekly-digest] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
