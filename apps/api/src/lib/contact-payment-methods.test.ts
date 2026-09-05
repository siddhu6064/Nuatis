import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const mockCustomersCreate = jest.fn(async () => ({ id: 'cus_1' }))
const mockSetupIntentsCreate = jest.fn(async () => ({
  client_secret: 'seti_1_secret',
  id: 'seti_1',
}))
const mockPaymentMethodsRetrieve = jest.fn(async () => ({
  id: 'pm_1',
  type: 'card',
  card: { last4: '4242' },
}))
const mockPaymentMethodsDetach = jest.fn(async () => ({}))
const mockPaymentIntentsCreate = jest.fn(async () => ({ id: 'pi_1', status: 'succeeded' }))

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomersCreate },
    setupIntents: { create: mockSetupIntentsCreate },
    paymentMethods: { retrieve: mockPaymentMethodsRetrieve, detach: mockPaymentMethodsDetach },
    paymentIntents: { create: mockPaymentIntentsCreate },
  })),
}))

const { getServiceClient } = await import('./supabase.js')
const {
  getOrCreateStripeCustomerForContact,
  createContactSetupIntent,
  attachSetupIntentPaymentMethod,
  removeContactPaymentMethod,
  chargeContactSavedMethod,
} = await import('./contact-payment-methods.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cpm0001'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000cpm0002'

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = [
    {
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      stripe_customer_id: null,
      default_payment_method_id: null,
    },
  ]
  mockCustomersCreate.mockClear()
  mockSetupIntentsCreate.mockClear()
  mockPaymentMethodsRetrieve.mockClear()
  mockPaymentMethodsDetach.mockClear()
  mockPaymentIntentsCreate.mockClear()
})

describe('getOrCreateStripeCustomerForContact', () => {
  it('creates and persists a new Stripe customer when none exists', async () => {
    const supabase = getServiceClient()
    const contact = (store.tables['contacts'] as Row[])[0] as unknown as {
      id: string
      tenant_id: string
      full_name: string | null
      email: string | null
      stripe_customer_id: string | null
      default_payment_method_id: string | null
    }

    const id = await getOrCreateStripeCustomerForContact(supabase, contact)
    expect(id).toEqual({ customerId: 'cus_1', connectAccountId: null })
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1)

    const rows = store.tables['contacts'] as Row[]
    expect(rows[0]?.['stripe_customer_id']).toBe('cus_1')
  })

  it('reuses an existing stripe_customer_id without calling Stripe', async () => {
    const supabase = getServiceClient()
    const id = await getOrCreateStripeCustomerForContact(supabase, {
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: null,
      email: null,
      stripe_customer_id: 'cus_existing',
      default_payment_method_id: null,
    })
    expect(id).toEqual({ customerId: 'cus_existing', connectAccountId: null })
    expect(mockCustomersCreate).not.toHaveBeenCalled()
  })
})

describe('createContactSetupIntent', () => {
  it('returns a client secret', async () => {
    const supabase = getServiceClient()
    const contact = (store.tables['contacts'] as Row[])[0] as unknown as {
      id: string
      tenant_id: string
      full_name: string | null
      email: string | null
      stripe_customer_id: string | null
      default_payment_method_id: string | null
    }
    const result = await createContactSetupIntent(supabase, contact)
    expect(result.clientSecret).toBe('seti_1_secret')
    expect(mockSetupIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', automatic_payment_methods: { enabled: true } }),
      undefined
    )
  })
})

describe('attachSetupIntentPaymentMethod', () => {
  it('saves the payment method type/last4 onto the contact', async () => {
    const supabase = getServiceClient()
    await attachSetupIntentPaymentMethod(supabase, {
      payment_method: 'pm_1',
      metadata: { tenantId: TENANT_ID, contactId: CONTACT_ID },
    } as never)

    const rows = store.tables['contacts'] as Row[]
    expect(rows[0]?.['default_payment_method_id']).toBe('pm_1')
    expect(rows[0]?.['default_payment_method_type']).toBe('card')
    expect(rows[0]?.['default_payment_method_last4']).toBe('4242')
  })

  it('detaches the previous payment method when replaced', async () => {
    const supabase = getServiceClient()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        default_payment_method_id: 'pm_old',
      },
    ]
    await attachSetupIntentPaymentMethod(supabase, {
      payment_method: 'pm_1',
      metadata: { tenantId: TENANT_ID, contactId: CONTACT_ID },
    } as never)

    expect(mockPaymentMethodsDetach).toHaveBeenCalledWith('pm_old', {}, undefined)
  })

  it('no-ops when metadata is missing', async () => {
    const supabase = getServiceClient()
    await attachSetupIntentPaymentMethod(supabase, {
      payment_method: 'pm_1',
      metadata: {},
    } as never)
    const rows = store.tables['contacts'] as Row[]
    expect(rows[0]?.['default_payment_method_id']).toBe(null)
  })
})

describe('removeContactPaymentMethod', () => {
  it('detaches and clears the saved method', async () => {
    const supabase = getServiceClient()
    store.tables['contacts'] = [
      { id: CONTACT_ID, tenant_id: TENANT_ID, default_payment_method_id: 'pm_1' },
    ]
    await removeContactPaymentMethod(supabase, TENANT_ID, CONTACT_ID)

    expect(mockPaymentMethodsDetach).toHaveBeenCalledWith('pm_1', {}, undefined)
    const rows = store.tables['contacts'] as Row[]
    expect(rows[0]?.['default_payment_method_id']).toBe(null)
  })
})

describe('chargeContactSavedMethod', () => {
  it('returns no_saved_method when the contact has none', async () => {
    const supabase = getServiceClient()
    const result = await chargeContactSavedMethod(supabase, {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      amountCents: 5000,
      description: 'Fee',
    })
    expect(result).toEqual({ charged: false, reason: 'no_saved_method' })
  })

  it('charges successfully when a saved method exists', async () => {
    const supabase = getServiceClient()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        stripe_customer_id: 'cus_1',
        default_payment_method_id: 'pm_1',
      },
    ]
    const result = await chargeContactSavedMethod(supabase, {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      amountCents: 5000,
      description: 'Fee',
    })
    expect(result).toEqual({ charged: true, paymentIntentId: 'pi_1' })
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        customer: 'cus_1',
        payment_method: 'pm_1',
        off_session: true,
        confirm: true,
      }),
      undefined
    )
  })

  it('falls back to charge_failed when Stripe throws (e.g. card declined)', async () => {
    const supabase = getServiceClient()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        stripe_customer_id: 'cus_1',
        default_payment_method_id: 'pm_1',
      },
    ]
    mockPaymentIntentsCreate.mockImplementationOnce(async () => {
      throw new Error('Your card was declined.')
    })
    const result = await chargeContactSavedMethod(supabase, {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      amountCents: 5000,
      description: 'Fee',
    })
    expect(result).toEqual({ charged: false, reason: 'charge_failed' })
  })

  it('returns charge_failed when the PaymentIntent does not succeed synchronously', async () => {
    const supabase = getServiceClient()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        stripe_customer_id: 'cus_1',
        default_payment_method_id: 'pm_1',
      },
    ]
    mockPaymentIntentsCreate.mockImplementationOnce(async () => ({
      id: 'pi_2',
      status: 'requires_action',
    }))
    const result = await chargeContactSavedMethod(supabase, {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      amountCents: 5000,
      description: 'Fee',
    })
    expect(result).toEqual({ charged: false, reason: 'charge_failed' })
  })
})
