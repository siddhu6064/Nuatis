import type { getServiceClient } from './supabase.js'

export interface ResolvedPromoCode {
  id: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
}

export type PromoCodeLookupResult =
  | { ok: true; promoCode: ResolvedPromoCode }
  | { ok: false; error: string }

// Validates a code is active, within its date window, and under its
// redemption cap. Does NOT increment redemption_count — callers that
// actually commit a redemption (quote creation/update) do that themselves
// as part of the same request, once the quote row is safely saved.
export async function resolvePromoCode(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  code: string
): Promise<PromoCodeLookupResult> {
  const { data } = await supabase
    .from('promo_codes')
    .select(
      'id, discount_type, discount_value, max_redemptions, redemption_count, valid_from, valid_until, active'
    )
    .eq('tenant_id', tenantId)
    .ilike('code', code.trim())
    .maybeSingle()

  if (!data) return { ok: false, error: 'Promo code not found' }
  if (!data.active) return { ok: false, error: 'Promo code is no longer active' }

  const now = new Date()
  if (data.valid_from && new Date(data.valid_from as string) > now) {
    return { ok: false, error: 'Promo code is not active yet' }
  }
  if (data.valid_until && new Date(data.valid_until as string) < now) {
    return { ok: false, error: 'Promo code has expired' }
  }
  if (
    typeof data.max_redemptions === 'number' &&
    (data.redemption_count as number) >= data.max_redemptions
  ) {
    return { ok: false, error: 'Promo code has reached its redemption limit' }
  }

  return {
    ok: true,
    promoCode: {
      id: data.id as string,
      discount_type: data.discount_type as 'percent' | 'fixed',
      discount_value: Number(data.discount_value),
    },
  }
}
