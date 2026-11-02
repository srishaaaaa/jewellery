import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, Lock, Plus, Save, Trash2, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errorMessage'
import { builtinAdminPasscode, DEFAULT_STAFF_PANELS } from '../../store/store'

/** Panels a staff login can be given. Settings always stays admin-only. */
const PANELS: Array<[string, string]> = [
  ['billing', 'Billing Panel'], ['advance_orders', 'Advance Orders'], ['history', 'Order History'], ['inventory', 'Inventory'],
  ['sales_desk', 'Sales Desk'], ['schemes', 'Schema'], ['metal_rates', 'Metal Rates'], ['customers', 'Customers'],
  ['customer_events', 'Special Occasions'], ['purchases', 'Purchases'], ['expenses', 'Expense Tracker'],
  ['outstanding_credits', 'Outstanding Credits'], ['pos_analytics', 'Analytics Dashboard'], ['coupons', 'Coupons'],
]

type StaffRow = { id?: string; name: string; login_id: string; passcode: string; panels: string[]; active: boolean; has_passcode?: boolean }

const label = 'block text-[10px] font-black uppercase tracking-[0.15em] text-[#000000]/60 mb-2'
const input = 'w-full rounded-xl border border-black/10 bg-white py-3 pl-10 pr-3 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
const plainInput = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
const blackBtn = 'inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-black disabled:opacity-50 cursor-pointer'

const KeyField = ({ value, onChange, show, placeholder }: { value: string; onChange: (v: string) => void; show: boolean; placeholder?: string }) => (
  <div className="relative">
    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
    <input type={show ? 'text' : 'password'} autoComplete="new-password" className={input} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </div>
)

function PanelChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PANELS.map(([id, name]) => {
        const on = value.includes(id)
        return (
          <button key={id} type="button" onClick={() => onChange(on ? value.filter((v) => v !== id) : [...value, id])}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer ${on ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-black/15 bg-white text-[#000000]/70 hover:bg-black/5'}`}>
            {on && <Check className="w-3.5 h-3.5" />}{name}
          </button>
        )
      })}
    </div>
  )
}

/** Settings: Login Passcodes and Staff Access (admin only). */
export function LoginAccessSettings() {
  const [show, setShow] = useState(false)
  const [current, setCurrent] = useState('')
  const [adminNew, setAdminNew] = useState(''); const [adminConfirm, setAdminConfirm] = useState('')
  const [staffNew, setStaffNew] = useState(''); const [staffConfirm, setStaffConfirm] = useState('')
  const [pcMsg, setPcMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [accessPass, setAccessPass] = useState('')
  const [sharedPanels, setSharedPanels] = useState<string[]>(DEFAULT_STAFF_PANELS)
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [accessMsg, setAccessMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    supabase.rpc('get_staff_access').then(({ data, error }) => {
      if (!live) return
      if (error) { setAccessMsg({ ok: false, text: 'Staff access needs the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.' }); return }
      const d = (data || {}) as { shared_panels?: string[]; staff?: StaffRow[] }
      if (Array.isArray(d.shared_panels)) setSharedPanels(d.shared_panels)
      setStaff((d.staff || []).map((s) => ({ ...s, passcode: '', panels: Array.isArray(s.panels) ? s.panels : [] })))
      setLoaded(true)
    })
    return () => { live = false }
  }, [])

  // With no admin passcode saved yet, the database cannot check it, so check the built-in one here.
  const adminOk = async (pass: string) => {
    const { data } = await supabase.rpc('pos_login', { p_login: 'admin', p_pass: pass })
    const r = (data || {}) as { role?: string | null; use_builtin?: boolean }
    if (r.role === 'admin') return true
    return Boolean(r.use_builtin) && pass.trim() === builtinAdminPasscode()
  }

  const changePasscode = async (kind: 'admin' | 'staff') => {
    const [next, confirm] = kind === 'admin' ? [adminNew, adminConfirm] : [staffNew, staffConfirm]
    setPcMsg(null)
    if (!current.trim()) { setPcMsg({ ok: false, text: 'Enter the current admin passcode.' }); return }
    if (next.trim().length < 4) { setPcMsg({ ok: false, text: 'The new passcode must have at least 4 characters.' }); return }
    if (next !== confirm) { setPcMsg({ ok: false, text: 'The new passcode and its confirmation do not match.' }); return }
    setBusy(true)
    try {
      if (!(await adminOk(current))) throw new Error('The current admin passcode is not correct.')
      const { error } = await supabase.rpc('change_pos_passcode', { p_current_admin: current.trim(), p_kind: kind, p_new: next.trim() })
      if (error) throw new Error(error.message)
      setPcMsg({ ok: true, text: kind === 'admin' ? 'Admin passcode changed. Use it the next time you sign in.' : 'Shared staff passcode changed.' })
      if (kind === 'admin') { setAdminNew(''); setAdminConfirm(''); setCurrent('') } else { setStaffNew(''); setStaffConfirm('') }
    } catch (err) {
      setPcMsg({ ok: false, text: getErrorMessage(err, 'Unable to change the passcode') })
    } finally { setBusy(false) }
  }

  const saveAccess = async () => {
    setAccessMsg(null)
    if (!accessPass.trim()) { setAccessMsg({ ok: false, text: 'Enter the admin passcode to save staff access.' }); return }
    setBusy(true)
    try {
      if (!(await adminOk(accessPass))) throw new Error('The admin passcode is not correct.')
      const { data, error } = await supabase.rpc('save_staff_access', {
        p_current_admin: accessPass.trim(), p_shared_panels: sharedPanels,
        p_staff: staff.map(({ id, name, login_id, passcode, panels, active }) => ({ id, name, login_id, passcode, panels, active })),
      })
      if (error) throw new Error(error.message)
      const d = (data || {}) as { staff?: StaffRow[] }
      setStaff((d.staff || []).map((s) => ({ ...s, passcode: '', panels: Array.isArray(s.panels) ? s.panels : [] })))
      setAccessMsg({ ok: true, text: 'Staff access saved. Staff see the new panels the next time they sign in.' })
    } catch (err) {
      setAccessMsg({ ok: false, text: getErrorMessage(err, 'Unable to save staff access') })
    } finally { setBusy(false) }
  }

  const setRow = (i: number, patch: Partial<StaffRow>) => setStaff((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const msg = (m: { ok: boolean; text: string } | null) => m && (
    <p className={`rounded-xl px-3 py-2 text-xs font-bold ${m.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{m.text}</p>
  )

  return (
    <div className="space-y-5">
      {/* ── Login passcodes ── */}
      <div className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[var(--accent)]"><Lock className="w-4 h-4" /> Login Passcodes</h3>
            <p className="mt-1 text-[11px] text-[#000000]/70">Change the passcodes used to sign in to the POS. Every change needs the current admin passcode. People already signed in stay signed in.</p>
          </div>
          <button type="button" onClick={() => setShow((v) => !v)} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#000000]/60 cursor-pointer">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="mt-5"><label className={label}>Current Admin Passcode</label><KeyField value={current} onChange={setCurrent} show={show} /></div>

        <div className="mt-5 border-t border-black/10 pt-5">
          <p className="text-xs font-black uppercase tracking-wider text-[#000000]">New Admin Passcode</p>
          <p className="text-[11px] text-[#000000]/60">Full access, including Settings and reports.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div><label className={label}>New Passcode</label><KeyField value={adminNew} onChange={setAdminNew} show={show} /></div>
            <div><label className={label}>Confirm New Passcode</label><KeyField value={adminConfirm} onChange={setAdminConfirm} show={show} /></div>
          </div>
          <button type="button" disabled={busy} onClick={() => void changePasscode('admin')} className={`${blackBtn} mt-4`}><Save className="w-4 h-4" /> Change Admin Passcode</button>
        </div>

        <div className="mt-5 border-t border-black/10 pt-5">
          <p className="text-xs font-black uppercase tracking-wider text-[#000000]">New Shared Staff Passcode</p>
          <p className="text-[11px] text-[#000000]/60">For staff without their own passcode. Their panels are set in Staff Access.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div><label className={label}>New Passcode</label><KeyField value={staffNew} onChange={setStaffNew} show={show} /></div>
            <div><label className={label}>Confirm New Passcode</label><KeyField value={staffConfirm} onChange={setStaffConfirm} show={show} /></div>
          </div>
          <button type="button" disabled={busy} onClick={() => void changePasscode('staff')} className={`${blackBtn} mt-4`}><Save className="w-4 h-4" /> Change Staff Passcode</button>
        </div>
        {pcMsg && <div className="mt-4">{msg(pcMsg)}</div>}
      </div>

      {/* ── Staff access ── */}
      <div className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[var(--accent)]"><Users className="w-4 h-4" /> Staff Access</h3>
        <p className="mt-1 text-[11px] text-[#000000]/70">Switch on POS access for each staff member, give them their own passcode, and choose the panels they see. Staff without their own login use the shared staff passcode and its panels. Remember to press Save Access. Settings always stays admin-only.</p>

        <div className="mt-5 max-w-md"><label className={label}>Admin Passcode (needed to save staff access)</label><KeyField value={accessPass} onChange={setAccessPass} show={show} /></div>

        <div className="mt-5 border-t border-black/10 pt-5">
          <p className="text-xs font-black uppercase tracking-wider text-[#000000]">Shared Staff Passcode</p>
          <p className="mb-3 text-[11px] text-[#000000]/60">Anyone signing in with the shared staff passcode. Also the starting panels for new staff.</p>
          <PanelChips value={sharedPanels} onChange={setSharedPanels} />
        </div>

        <div className="mt-5 border-t border-black/10 pt-5 space-y-4">
          {staff.length === 0 && <p className="text-xs font-semibold text-[#000000]/60">No staff with their own passcode yet. Add a staff member to give them a personal login and panels.</p>}
          {staff.map((r, i) => (
            <div key={r.id || `new-${i}`} className="rounded-xl border border-black/10 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <div><label className={label}>Name</label><input className={plainInput} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="e.g. Priya" /></div>
                <div><label className={label}>Login ID</label><input className={plainInput} value={r.login_id} onChange={(e) => setRow(i, { login_id: e.target.value })} placeholder="e.g. priya" /></div>
                <div><label className={label}>{r.has_passcode ? 'New passcode (blank = keep)' : 'Passcode'}</label><input type={show ? 'text' : 'password'} autoComplete="new-password" className={plainInput} value={r.passcode} onChange={(e) => setRow(i, { passcode: e.target.value })} /></div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setRow(i, { active: !r.active })}
                    className={`rounded-lg px-3 py-2.5 text-[10px] font-black uppercase tracking-wider cursor-pointer ${r.active ? 'bg-emerald-600 text-white' : 'bg-black/10 text-[#000000]'}`}>{r.active ? 'POS On' : 'POS Off'}</button>
                  <button type="button" title="Remove staff login" onClick={() => setStaff((rows) => rows.filter((_, k) => k !== i))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#DC2626]/10 text-[#DC2626] hover:bg-[#DC2626]/20 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="mt-3"><PanelChips value={r.panels} onChange={(panels) => setRow(i, { panels })} /></div>
            </div>
          ))}
          <button type="button" disabled={!loaded} onClick={() => setStaff((rows) => [...rows, { name: '', login_id: '', passcode: '', panels: [...sharedPanels], active: true }])}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-black/30 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-[#000000] hover:bg-black/5 disabled:opacity-40 cursor-pointer">
            <Plus className="w-4 h-4" /> Add Staff Login
          </button>
        </div>

        <div className="mt-5 border-t border-black/10 pt-5 space-y-3">
          {msg(accessMsg)}
          <button type="button" disabled={busy || !loaded} onClick={() => void saveAccess()} className={blackBtn}><Save className="w-4 h-4" /> Save Access</button>
        </div>
      </div>
    </div>
  )
}
