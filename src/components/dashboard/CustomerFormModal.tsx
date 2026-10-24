import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { DateInputDDMMYYYY } from '../DateInputDDMMYYYY'
import { normalizePhone } from '../../lib/phone'
import { getErrorMessage } from '../../lib/errorMessage'
import { auditService } from '../../services/auditService'
import { customerService, isValidAadhaar, isValidPan, normalizeAadhaar, type CustomerRecord } from '../../services/customerService'

const inputClass = 'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm text-[#273126] outline-none transition focus:border-[var(--accent-dark)] focus:ring-2 focus:ring-[var(--accent-a10)]'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-[#6B7280]">{label}</span>{children}</label>
}

/**
 * Add or edit a customer without a bill. Only name and mobile are needed, so a walk-in who shares
 * nothing else is still saved for reminders and offers; everything else is optional.
 */
export function CustomerFormModal({ customer, onClose, onSaved }: {
  customer: CustomerRecord | null
  onClose: () => void
  onSaved: (saved: CustomerRecord) => void
}) {
  const [form, setForm] = useState({
    name: customer?.name || '', phone: customer?.phone || '', email: customer?.email || '', address: customer?.address || '',
    birthday: customer?.birthday || '', anniversary: customer?.anniversary || '',
    aadhaar: customer?.aadhaar || '', pan: customer?.pan || '', allowOffers: customer?.allowOffers !== false, notes: customer?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const phone = normalizePhone(form.phone)
    if (!form.name.trim()) { setError('Enter the customer name.'); return }
    if (!phone) { setError('Enter a valid 10-digit mobile number.'); return }
    if (form.aadhaar.trim() && !isValidAadhaar(form.aadhaar)) { setError('Aadhaar number must be 12 digits.'); return }
    if (form.pan.trim() && !isValidPan(form.pan)) { setError('PAN must be like ABCDE1234F.'); return }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError('Enter a valid email address.'); return }
    setSaving(true)
    setError('')
    const input = {
      phone, name: form.name, address: form.address, birthday: form.birthday || null, anniversary: form.anniversary || null,
      email: form.email, aadhaar: normalizeAadhaar(form.aadhaar) || null, pan: form.pan.trim().toUpperCase() || null,
      allowOffers: form.allowOffers, notes: form.notes,
    }
    try {
      let saved: CustomerRecord
      if (customer) {
        await customerService.update(customer.id, input)
        saved = { ...customer, ...input, name: input.name.trim(), address: input.address.trim(), email: input.email.trim(), notes: input.notes.trim() }
      } else {
        saved = await customerService.create(input)
      }
      void auditService.log({ action: customer ? 'customer_updated' : 'customer_created', entityType: 'customer', entityId: phone, newValue: { name: saved.name } })
      onSaved(saved)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to save the customer'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
        <form onSubmit={submit} className="flex w-full max-w-2xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
          <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
            <div>
              <h3 className="text-xl font-black text-[#273126]">{customer ? 'Edit Customer' : 'Add Customer'}</h3>
              <p className="text-xs text-[#6B7280]">Only name and mobile are needed. Saved customers get reminders and offers.</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 text-[#858C83] hover:text-black" aria-label="Close"><X size={20} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 grid gap-4 sm:grid-cols-2">
            {error && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div>}
            <Field label="Customer Name *"><input required className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Mobile Number *"><input required inputMode="tel" className={inputClass} value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Address"><input className={inputClass} value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
            <DateInputDDMMYYYY label="Birthday" value={form.birthday} onChange={(v) => set({ birthday: v })} placeholder="DD/MM/YYYY" />
            <DateInputDDMMYYYY label="Anniversary" value={form.anniversary} onChange={(v) => set({ anniversary: v })} placeholder="DD/MM/YYYY" />
            <Field label="Aadhaar No."><input inputMode="numeric" maxLength={14} className={inputClass} value={form.aadhaar} onChange={(e) => set({ aadhaar: e.target.value.replace(/[^0-9 ]/g, '') })} placeholder="12 digits" /></Field>
            <Field label="PAN"><input maxLength={10} className={inputClass} value={form.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="ABCDE1234F" /></Field>
            <div className="sm:col-span-2"><Field label="Notes"><input className={inputClass} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Prefers antique designs" /></Field></div>
            <label className="sm:col-span-2 flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.allowOffers} onChange={(e) => set({ allowOffers: e.target.checked })} className="mt-0.5 w-4 h-4 accent-[var(--accent)]" />
              <span>
                <span className="block text-[13px] font-bold text-[#111111]">Send reminders and offers</span>
                <span className="block text-[11px] text-[#6B7280]">Untick if the customer does not want to be contacted.</span>
              </span>
            </label>
          </div>
          <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
            <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : customer ? 'Save Changes' : 'Add Customer'}</button>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}
