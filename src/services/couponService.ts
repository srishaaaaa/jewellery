import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/retail'

const COUPON_COLUMNS = 'id, code, percentage, is_active, expiry_date, usage_limit, usage_count, min_order_value'

export type AppliedCoupon = {
  code: string
  percentage: number
  discount: number
}

export async function validateCoupon(
  rawCode: string,
  subtotal: number,
): Promise<{ data: AppliedCoupon | null; error: string | null }> {
  const code = rawCode.trim().toUpperCase()

  if (!isSupabaseConfigured) {
    return { data: null, error: 'Coupon validation requires a live connection' }
  }

  try {
    const { data, error: dbErr } = await supabase
      .from('coupons')
      .select(COUPON_COLUMNS)
      .eq('is_active', true)
      .ilike('code', code)
      .single()

    if (dbErr || !data) return { data: null, error: 'Invalid or expired coupon code' }

    if (data.expiry_date && new Date(data.expiry_date) < new Date()) {
      return { data: null, error: 'This coupon has expired' }
    }

    const usageLimit = Number(data.usage_limit || 0)
    const usageCount = Number(data.usage_count || 0)
    if (usageLimit > 0 && usageCount >= usageLimit) {
      return { data: null, error: 'Coupon usage limit has been reached' }
    }

    if (data.min_order_value && subtotal < Number(data.min_order_value)) {
      return {
        data: null,
        error: `Minimum order of ${formatCurrency(Number(data.min_order_value))} required`,
      }
    }

    const discount = Math.round((subtotal * Number(data.percentage) / 100) * 100) / 100
    return {
      data: { code: String(data.code), percentage: Number(data.percentage), discount },
      error: null,
    }
  } catch {
    return { data: null, error: 'Failed to validate coupon. Try again.' }
  }
}
