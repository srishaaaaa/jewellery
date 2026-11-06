import { supabase } from './supabase'

/** Customer portal session: a random token from customer_verify_otp, kept on this device. */
const KEY = 'jewellery_customer_session'

export type PortalCustomer = { id: string; name: string; phone: string }
export type PortalSession = { token: string; customer: PortalCustomer }

export const readPortalSession = (): PortalSession | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') as PortalSession | null } catch { return null }
}
export const savePortalSession = (s: PortalSession | null) => {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY) } catch { /* storage blocked */ }
}

export class PortalSessionExpired extends Error {}

/** Calls a customer portal function with the session token; an expired session logs the customer out. */
export async function portalRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const session = readPortalSession()
  if (!session) throw new PortalSessionExpired('Please log in again.')
  const { data, error } = await supabase.rpc(fn, { p_token: session.token, ...args })
  if (error) {
    if (/SESSION_EXPIRED/.test(error.message)) { savePortalSession(null); throw new PortalSessionExpired('Your session has ended. Please log in again.') }
    throw new Error(error.message)
  }
  return data as T
}

/** Asks the customer-otp Edge Function to send an OTP. */
export async function requestOtp(phone: string): Promise<{ ok: true; resendIn: number; expiresIn: number } | { ok: false; code: 'NOT_REGISTERED' | 'NOT_CONFIGURED' | 'ERROR'; message: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('customer-otp', { body: { phone } })
    let body = (data || {}) as { ok?: boolean; error?: string; resend_in_seconds?: number; expires_in_seconds?: number }
    if (error && 'context' in error) {
      try { body = (await (error as { context: Response }).context.json()) as typeof body } catch { /* no body */ }
    }
    if (body.ok) return { ok: true, resendIn: body.resend_in_seconds || 60, expiresIn: body.expires_in_seconds || 300 }
    if (body.error === 'NOT_REGISTERED') return { ok: false, code: 'NOT_REGISTERED', message: 'This mobile number is not registered with the shop.' }
    if (body.error === 'OTP_NOT_CONFIGURED' || (!body.error && error)) {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'OTP login is not switched on yet. Please contact the shop.' }
    }
    return { ok: false, code: 'ERROR', message: body.error || 'Could not send the OTP. Please try again.' }
  } catch {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'OTP login is not switched on yet. Please contact the shop.' }
  }
}

export async function verifyOtp(phone: string, code: string): Promise<PortalSession> {
  const { data, error } = await supabase.rpc('customer_verify_otp', { p_phone: phone, p_code: code })
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, '') === 'NOT_REGISTERED' ? 'This mobile number is not registered with the shop.' : error.message)
  const r = data as { token: string; customer: PortalCustomer }
  const session = { token: r.token, customer: r.customer }
  savePortalSession(session)
  return session
}

export async function portalLogout() {
  const s = readPortalSession()
  savePortalSession(null)
  if (s) await supabase.rpc('customer_logout', { p_token: s.token }).then(() => undefined, () => undefined)
}

// ── Data shapes returned by the portal functions ──
export type PortalBill = {
  id: string; invoice_no: string; created_at: string; total: number; status: string; payment_mode: string | null
  total_gst: number; advance_amount_used: number; exchange_amount: number; scheme_amount_used: number
  credit_status: string | null; balance: number; paid: number
  pay_status: 'paid' | 'partially_paid' | 'pending' | 'awaiting_verification' | 'cancelled' | 'refunded'
  items: Array<Record<string, unknown>>
}
export type PortalScheme = {
  id: string; scheme_number: string; scheme_name: string; frequency: string; monthly_amount: number; total_installments: number
  installments_paid: number; total_paid: number; amount_redeemed: number; start_date: string; maturity_date: string
  next_due_date: string | null; status: string; total_grams: number; gold_purity: string; benefit_type: string
  making_benefit_value: number; making_benefit_unit: string; wastage_benefit_value: number; wastage_benefit_unit: string
  benefit_used: boolean; benefit_forfeited: boolean; duration_months: number
}
export type PortalPayment = {
  kind: 'bill' | 'claim' | 'scheme'; date: string; invoice_no: string; amount: number; method: string | null
  reference: string | null; status: string; verified_at: string | null; reason?: string | null; scheme_id?: string; installment_id?: string
}
export type PortalData = {
  customer: { id: string; code: string; name: string; phone: string; email: string; address: string; created_at: string }
  bills: PortalBill[]; schemes: PortalScheme[]; payments: PortalPayment[]; unread: number
}
export type PortalNotification = { id: string; kind: string; title: string; body: string; ref_type: string; ref_id: string; read_at: string | null; created_at: string }

export const PAY_STATUS_LABELS: Record<PortalBill['pay_status'], string> = {
  paid: 'Paid', partially_paid: 'Partially Paid', pending: 'Pending', awaiting_verification: 'Awaiting UPI Verification', cancelled: 'Cancelled', refunded: 'Refunded',
}
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  verified: 'Verified', awaiting_verification: 'Awaiting Verification', rejected: 'Rejected', pending: 'Pending', failed: 'Failed',
}

export const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
