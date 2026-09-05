import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendSms = jest.fn(async () => ({ success: true, messageId: 'msg_1' }))
const notifyOwner = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cr01001'
const REFERRER_ID = 'bbbbbbbb-0000-0000-0000-00000cr01002'
const REFERRED_ID = 'cccccccc-0000-0000-0000-00000cr01003'
const APPOINTMENT_ID = 'dddddddd-0000-0000-0000-00000cr01004'

const { processCustomerReferralReward } = await import('./customer-referral-worker.js')

function seedTenant(overrides: Row = {}): void {
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Test Biz',
      customer_referral_program_enabled: true,
      customer_referral_reward_cents: 1000,
      customer_referral_referred_reward_cents: 0,
      ...overrides,
    },
  ]
}

beforeEach(() => {
  store = createStore()
  seedTenant()
  store.tables['contacts'] = [
    {
      id: REFERRER_ID,
      tenant_id: TENANT_ID,
      full_name: 'Ref Erra',
      phone: '+15125551111',
      email: 'ref@example.com',
    },
    {
      id: REFERRED_ID,
      tenant_id: TENANT_ID,
      full_name: 'Ref Erred',
      phone: '+15125552222',
      email: 'red@example.com',
    },
  ]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, telnyx_number: '+15125559999' },
  ]
  store.tables['customer_referral_rewards'] = []
  store.tables['gift_cards'] = []
  sendSms.mockClear()
  notifyOwner.mockClear()
  logActivity.mockClear()
})

describe('processCustomerReferralReward', () => {
  it('issues a referrer-only gift card and marks the reward issued', async () => {
    await processCustomerReferralReward({
      tenantId: TENANT_ID,
      referredContactId: REFERRED_ID,
      referrerContactId: REFERRER_ID,
      triggerType: 'appointment',
      triggerId: APPOINTMENT_ID,
    })

    const rewards = store.tables['customer_referral_rewards'] as Row[]
    expect(rewards).toHaveLength(1)
    expect(rewards[0]?.['status']).toBe('issued')
    expect(rewards[0]?.['referrer_gift_card_id']).toBeTruthy()
    expect(rewards[0]?.['referred_gift_card_id']).toBeNull()

    const cards = store.tables['gift_cards'] as Row[]
    expect(cards).toHaveLength(1)
    expect(cards[0]?.['purchased_by_contact_id']).toBe(REFERRER_ID)
    expect(cards[0]?.['amount_cents']).toBe(1000)
    expect(cards[0]?.['payment_method']).toBeFalsy()

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('also issues a referred-friend card when referredRewardCents > 0', async () => {
    seedTenant({ customer_referral_referred_reward_cents: 500 })

    await processCustomerReferralReward({
      tenantId: TENANT_ID,
      referredContactId: REFERRED_ID,
      referrerContactId: REFERRER_ID,
      triggerType: 'order',
      triggerId: 'order-1',
    })

    const cards = store.tables['gift_cards'] as Row[]
    expect(cards).toHaveLength(2)
    const referredCard = cards.find((c) => c['purchased_by_contact_id'] === REFERRED_ID)
    expect(referredCard?.['amount_cents']).toBe(500)

    const rewards = store.tables['customer_referral_rewards'] as Row[]
    expect(rewards[0]?.['referred_gift_card_id']).toBe(referredCard?.['id'])
  })

  // NOTE: the actual idempotency guarantee (one reward per referred_contact_id,
  // ever) is enforced by the unique index in migration 0146, not application
  // code — supabase-mock.ts doesn't simulate unique-constraint violations
  // (confirmed: no constraint/23505 handling anywhere in that file), so a
  // duplicate-trigger race can't be represented against this mock. The
  // 23505-handling branch in processCustomerReferralReward is covered by
  // reading the code, not a test, for that reason.
  it('marks the reward failed (not thrown) if the referrer contact is missing', async () => {
    store.tables['contacts'] = [
      { id: REFERRED_ID, tenant_id: TENANT_ID, full_name: 'Ref Erred', phone: '+15125552222' },
    ]

    await expect(
      processCustomerReferralReward({
        tenantId: TENANT_ID,
        referredContactId: REFERRED_ID,
        referrerContactId: REFERRER_ID,
        triggerType: 'appointment',
        triggerId: APPOINTMENT_ID,
      })
    ).resolves.toBeUndefined()

    const rewards = store.tables['customer_referral_rewards'] as Row[]
    expect(rewards[0]?.['status']).toBe('failed')
    expect(store.tables['gift_cards']).toHaveLength(0)
  })

  it('does nothing when the program is disabled', async () => {
    seedTenant({ customer_referral_program_enabled: false })

    await processCustomerReferralReward({
      tenantId: TENANT_ID,
      referredContactId: REFERRED_ID,
      referrerContactId: REFERRER_ID,
      triggerType: 'appointment',
      triggerId: APPOINTMENT_ID,
    })

    expect(store.tables['customer_referral_rewards']).toHaveLength(0)
    expect(store.tables['gift_cards']).toHaveLength(0)
  })

  it('does nothing when the referrer reward amount is 0', async () => {
    seedTenant({ customer_referral_reward_cents: 0 })

    await processCustomerReferralReward({
      tenantId: TENANT_ID,
      referredContactId: REFERRED_ID,
      referrerContactId: REFERRER_ID,
      triggerType: 'appointment',
      triggerId: APPOINTMENT_ID,
    })

    expect(store.tables['customer_referral_rewards']).toHaveLength(0)
  })
})
