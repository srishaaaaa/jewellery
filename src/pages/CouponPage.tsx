import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { couponTerms, createCouponPdf, type ShareableCoupon } from '../lib/couponShare'
import { useSettingsStore } from '../store/store'
import { BRAND_EN } from '../lib/brand'

/** Public page opened from the WhatsApp link: shows the coupon and lets the customer download it. */
export default function CouponPage() {
  const { code = '' } = useParams()
  const shopName = useSettingsStore((s) => s.settings?.name) || BRAND_EN
  const [coupon, setCoupon] = useState<ShareableCoupon | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'inactive'>(isSupabaseConfigured ? 'loading' : 'missing')

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.from('coupons').select('*').ilike('code', code.trim()).maybeSingle()
      .then(({ data }) => {
        if (!data) { setState('missing'); return }
        const expired = data.expiry_date && new Date(data.expiry_date) < new Date()
        setCoupon({
          id: Number(data.id),
          code: String(data.code),
          percentage: Number(data.percentage),
          expiry_date: data.expiry_date,
          min_order_value: Number(data.min_order_value || 0),
          allowed_phones: Array.isArray(data.allowed_phones) ? data.allowed_phones : [],
        })
        setState(!data.is_active || expired ? 'inactive' : 'ok')
      }, () => setState('missing'))
  }, [code])

  const download = () => {
    if (!coupon) return
    const file = createCouponPdf(coupon, '', Boolean(coupon.allowed_phones?.length))
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl border-2 border-dashed border-[var(--accent)] bg-white p-6 text-center shadow-xl">
        <p className="text-lg font-black text-[#000000]">{shopName}</p>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#000000]/60">Gift Coupon</p>

        {state === 'loading' && <div className="mx-auto my-10 h-10 w-10 animate-spin rounded-full border-4 border-black/10 border-t-[var(--accent)]" />}
        {state === 'missing' && <p className="my-10 text-sm font-semibold text-[#000000]">This coupon could not be found.</p>}

        {coupon && state !== 'missing' && (
          <>
            <p className="mt-6 text-5xl font-black text-[var(--accent)]">{coupon.percentage}% OFF</p>
            <p className="mx-auto mt-4 inline-block rounded-xl bg-[#0A0A0A] px-6 py-2.5 font-mono text-xl font-black tracking-[0.2em] text-white">{coupon.code}</p>
            {state === 'inactive' && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">This coupon is no longer active.</p>
            )}
            <ul className="mt-5 space-y-1 text-xs font-semibold text-[#000000]/80">
              {couponTerms(coupon, Boolean(coupon.allowed_phones?.length)).map((t) => <li key={t}>{t}</li>)}
            </ul>
            {state === 'ok' && (
              <button type="button" onClick={download}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A0A0A] py-3 text-sm font-black text-white hover:bg-[#1A1A1A] cursor-pointer">
                <Download size={16} /> Download coupon
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
