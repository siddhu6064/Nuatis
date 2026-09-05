import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { getFirstName } from '@nuatis/shared'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'
import { sendSms } from '../lib/sms.js'
import { notifyOwner } from '../lib/notifications.js'
import { isScannerPaused } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'customer-referral-reward'

interface CustomerReferralJobData {
  tenantId: string
  referredContactId: string
  referrerContactId: string
  triggerType: 'appointment' | 'order'
  triggerId: string
}

export async function processCustomerReferralReward(data: CustomerReferralJobData): Promise<void> {
  const { tenantId, referredContactId, referrerContactId, triggerType, triggerId } = data
  const supabase = getServiceClient()

  // 1. Fetch tenant settings
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select(
      'customer_referral_program_enabled, customer_referral_reward_cents, customer_referral_referred_reward_cents, name'
    )
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant || !tenant.customer_referral_program_enabled) {
    console.info(`[customer-referral] skipped — disabled or tenant not found: tenant=${tenantId}`)
    return
  }

  const referrerRewardCents = Number(tenant.customer_referral_reward_cents ?? 0)
  if (referrerRewardCents <= 0) {
    console.info(`[customer-referral] skipped — no reward configured: tenant=${tenantId}`)
    return
  }

  // 2. Atomically reserve the reward slot. The unique index on
  // referred_contact_id means at most one reward is ever issued per
  // referred contact — a losing insert (23505) means the other trigger
  // path (appointment vs order) already claimed it. This is what "first
  // booking or purchase, whichever happens first" means operationally.
  const { data: rewardRow, error: insertError } = await supabase
    .from('customer_referral_rewards')
    .insert({
      tenant_id: tenantId,
      referrer_contact_id: referrerContactId,
      referred_contact_id: referredContactId,
      trigger_type: triggerType,
      trigger_appointment_id: triggerType === 'appointment' ? triggerId : null,
      trigger_order_id: triggerType === 'order' ? triggerId : null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !rewardRow) {
    if ((insertError as { code?: string } | null)?.code !== '23505') {
      console.error('[customer-referral] failed to reserve reward row:', insertError)
    } else {
      console.info(`[customer-referral] skipped — already rewarded contact=${referredContactId}`)
    }
    return
  }

  // 3. Fetch referrer, issue their gift card. payment_method is left NULL —
  // this card was earned, not purchased; the CHECK constraint only fires
  // on non-null values.
  const { data: referrer } = await supabase
    .from('contacts')
    .select('full_name, phone, email')
    .eq('id', referrerContactId)
    .single()

  if (!referrer) {
    await supabase
      .from('customer_referral_rewards')
      .update({ status: 'failed' })
      .eq('id', rewardRow.id)
    console.warn(`[customer-referral] referrer contact not found: contact=${referrerContactId}`)
    return
  }

  const { data: referrerCard, error: cardError } = await supabase
    .from('gift_cards')
    .insert({
      tenant_id: tenantId,
      amount_cents: referrerRewardCents,
      balance_cents: referrerRewardCents,
      recipient_name: referrer.full_name,
      recipient_email: referrer.email,
      purchased_by_contact_id: referrerContactId,
      status: 'active',
    })
    .select('id, code')
    .single()

  if (cardError || !referrerCard) {
    await supabase
      .from('customer_referral_rewards')
      .update({ status: 'failed' })
      .eq('id', rewardRow.id)
    console.error('[customer-referral] failed to issue referrer gift card:', cardError)
    return
  }

  // 4. Optional referred-friend reward (disabled by default — 0 cents)
  let referredCardId: string | null = null
  const referredRewardCents = Number(tenant.customer_referral_referred_reward_cents ?? 0)
  if (referredRewardCents > 0) {
    const { data: referredContact } = await supabase
      .from('contacts')
      .select('full_name, email')
      .eq('id', referredContactId)
      .maybeSingle()
    const { data: referredCard } = await supabase
      .from('gift_cards')
      .insert({
        tenant_id: tenantId,
        amount_cents: referredRewardCents,
        balance_cents: referredRewardCents,
        recipient_name: referredContact?.full_name ?? null,
        recipient_email: referredContact?.email ?? null,
        purchased_by_contact_id: referredContactId,
        status: 'active',
      })
      .select('id')
      .single()
    referredCardId = (referredCard?.id as string | undefined) ?? null
  }

  // 5. Mark issued
  await supabase
    .from('customer_referral_rewards')
    .update({
      status: 'issued',
      referrer_gift_card_id: referrerCard.id,
      referred_gift_card_id: referredCardId,
      issued_at: new Date().toISOString(),
    })
    .eq('id', rewardRow.id)

  console.info(
    `[customer-referral] issued reward: referrer=${referrerContactId} referred=${referredContactId} trigger=${triggerType}`
  )

  // 6. Activity + best-effort SMS + notify owner
  const businessName = (tenant.name as string | null) ?? 'us'
  const firstName = getFirstName(referrer.full_name, '')
  await logActivity({
    tenantId,
    contactId: referrerContactId,
    type: 'system',
    body: `Referral reward issued: $${(referrerRewardCents / 100).toFixed(2)} gift card (${referrerCard.code as string}).`,
    metadata: {
      customer_referral_reward_id: rewardRow.id,
      gift_card_id: referrerCard.id,
      automated: true,
    },
    actorType: 'system',
  })

  if (referrer.phone) {
    const { data: location } = await supabase
      .from('locations')
      .select('telnyx_number')
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .maybeSingle()
    if (location?.telnyx_number) {
      const smsBody = `Hi ${firstName || 'there'}, thanks for referring a friend to ${businessName}! Your $${(referrerRewardCents / 100).toFixed(2)} reward — gift card code: ${referrerCard.code as string}.`
      await sendSms(location.telnyx_number as string, referrer.phone, smsBody, {
        tenantId,
        contactId: referrerContactId,
      })
    }
  }

  await notifyOwner(tenantId, 'customer_referral_reward_issued', {
    pushTitle: 'Referral Reward Issued',
    pushBody: `${firstName || 'A customer'} earned a $${(referrerRewardCents / 100).toFixed(2)} referral reward`,
  })
}

export function createCustomerReferralWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const jobData = job.data as { tenantId: string }
      if (await isScannerPaused(jobData.tenantId, QUEUE_NAME)) {
        console.info(`[customer-referral] paused for tenant=${jobData.tenantId} — skipping`)
        return
      }
      await processCustomerReferralReward(job.data as CustomerReferralJobData)
    },
    { connection, skipVersionCheck: true }
  )

  worker.on('failed', (job, err) => {
    console.error(`[customer-referral] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
