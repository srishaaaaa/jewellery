import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { UpiQr } from '../../components/UpiQr'
import { BRAND_LOGO } from '../../lib/brand'
import { formatInvoiceNo } from '../../lib/retail'
import { inr } from '../../lib/customerPortal'

type LinkInfo = {
  state: 'open' | 'expired' | 'revoked' | 'paid' | 'not_found' | 'no_upi'
  kind?: 'bill' | 'advance' | 'scheme'
  invoice_no?: string; amount?: number; expires_at?: string; customer_first_name?: string; shop_name?: string
  upi_id?: string; upi_name?: string; rotate_minutes?: number; logo_url?: string | null; pending_claim?: boolean
}

const STATE_TEXT: Record<Exclude<LinkInfo['state'], 'open'>, string> = {
  expired: 'This payment link has expired. Please ask the shop for a new one.',
  revoked: 'This payment link was cancelled by the shop. Please ask the shop for a new one.',
  paid: 'There is no balance to pay. Thank you!',
  not_found: 'This payment link is not valid.',
  no_upi: 'UPI payments are not set up at the shop yet. Please pay at the counter.',
}

/**
 * Public UPI payment page (/customer/pay/:token): the shop's QR for the approved balance of one bill.
 * "I've Paid" only tells the shop to check: the bill is marked paid after the shop confirms the money arrived.
 */
const docWord = (info: LinkInfo | null) => info?.kind === 'scheme' ? 'scheme' : info?.kind === 'advance' || info?.invoice_no?.startsWith('DEP-') ? 'order' : 'invoice'

export default function PayPage() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [utr, setUtr] = useState('')
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let live = true
    const load = () => supabase.rpc('get_payment_link', { p_token: token }).then(({ data, error: err }) => {
      if (!live) return
      if (err) { setInfo({ state: 'not_found' }); return }
      setInfo(data as LinkInfo)
    })
    void load()
    const t = window.setInterval(() => void load(), 60000)
    return () => { live = false; window.clearInterval(t) }
  }, [token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const amt = amount.trim() === '' || info?.kind === 'scheme' ? info?.amount || 0 : Number(amount)
    if (!(amt > 0) || amt > (info?.amount || 0)) { setError(`Enter an amount up to ${inr(info?.amount || 0)}.`); return }
    if (utr.trim() && !/^[A-Za-z0-9]{6,35}$/.test(utr.trim())) { setError('Enter the UPI transaction ID / UTR exactly as shown in your UPI app.'); return }
    if (file && (file.size > 5 * 1024 * 1024 || !/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type))) { setError('Screenshot must be a PNG, JPG, WEBP or PDF under 5 MB.'); return }
    setBusy(true)
    try {
      let path = ''
      if (file) {
        path = `${token.slice(0, 12)}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
        const up = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false })
        if (up.error) path = ''
      }
      const { error: err } = await supabase.rpc('submit_payment_claim', {
        p_link_token: token, p_utr: utr.trim(), p_amount: amt, p_paid_at: paidAt ? new Date(paidAt).toISOString() : null,
        p_screenshot_path: path, p_note: '',
      })
      if (err) throw new Error(err.message)
      setDone(true); setClaimOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*?:\s/, '') : 'Could not send the payment details.')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-[#FAFAF7] p-4">
      <div className="mx-auto w-full max-w-md space-y-4 py-4">
        <div className="flex items-center gap-3">
          <img src={info?.logo_url || BRAND_LOGO} alt="" className="h-12 w-12 rounded-xl border border-black/10 bg-white object-contain" />
          <div><p className="text-sm font-black uppercase tracking-wider">{info?.shop_name || 'Jewellery shop'}</p><p className="text-[11px] font-semibold text-black/60">Secure UPI payment</p></div>
        </div>
        {!info ? <p className="text-sm text-black/60">Loading…</p> : info.state !== 'open' ? (
          <div className="rounded-2xl border border-black/10 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold">{STATE_TEXT[info.state]}</p>
            {info.invoice_no && <p className="mt-1 text-xs capitalize text-black/60">{docWord(info)} {info.kind === 'scheme' ? info.invoice_no : formatInvoiceNo(info.invoice_no)}</p>}
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold text-black/60">{info.customer_first_name ? `Hi ${info.customer_first_name}, ` : ''}{info.kind === 'scheme' ? `installment to pay for scheme ${info.invoice_no || ''}` : `amount to pay for ${docWord(info)} ${formatInvoiceNo(info.invoice_no || '')}`}</p>
              <p className="mt-1 text-3xl font-black">{inr(info.amount || 0)}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-black/50"><Clock className="h-3.5 w-3.5" /> Link valid until {info.expires_at ? new Date(info.expires_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
              <div className="mt-4">
                <UpiQr upiId={info.upi_id || ''} name={info.upi_name || info.shop_name || ''} amount={info.amount || 0} invoiceNo={info.invoice_no || 'PAY'} rotateMinutes={info.rotate_minutes || 5} />
              </div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white p-5 text-xs shadow-sm">
              <p className="mb-2 font-black uppercase tracking-wider">How to pay</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Scan the QR with Google Pay, PhonePe, Paytm or any UPI app — or tap <b>Open My UPI App</b> on your phone.</li>
                <li>Check the amount ({inr(info.amount || 0)}) and the name <b>{info.upi_name || info.shop_name}</b>, then pay.</li>
                <li>Come back here and tap <b>I've Paid</b>. Add the UPI transaction ID (UTR) so the shop can find it quickly.</li>
              </ol>
              <p className="mt-2 flex items-start gap-1 text-[11px] text-black/60"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Your {info.kind === 'scheme' ? 'installment' : docWord(info) === 'order' ? 'order' : 'bill'} is marked paid after the shop sees the money in its account.</p>
            </div>
            {(done || info.pending_claim) ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="mb-1 h-5 w-5" /> Your payment notification has been sent to the shop. The payment will be confirmed after verification.
              </div>
            ) : claimOpen ? (
              <form onSubmit={submit} className="space-y-3 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
                {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
                <label className="block text-xs font-bold">UPI transaction ID / UTR (recommended)<input className="mt-1 w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm uppercase" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 431286547123" /></label>
                {info.kind === 'scheme'
                  ? <p className="text-xs font-bold">Amount paid: {inr(info.amount || 0)} (one installment)</p>
                  : <label className="block text-xs font-bold">Amount paid<input type="number" min="1" step="0.01" max={info.amount} className="mt-1 w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(info.amount || '')} /></label>}
                <label className="block text-xs font-bold">Paid at (optional)<input type="datetime-local" className="mt-1 w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></label>
                <label className="block text-xs font-bold">Payment screenshot (optional)<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="mt-1 block w-full text-xs" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
                <button disabled={busy} className="w-full rounded-xl bg-[#111111] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send to the shop'}</button>
              </form>
            ) : (
              <button type="button" onClick={() => setClaimOpen(true)} className="w-full rounded-xl border-2 border-[#111111] bg-white py-3 text-xs font-black uppercase tracking-wider cursor-pointer">I've Paid</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
