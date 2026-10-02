import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Store, Phone, MapPin, Palette, Package, SlidersHorizontal, Lock, RefreshCw, Camera, Trash2, X, Check, AlertCircle, Save } from 'lucide-react'
import { useSettingsStore, useAdminAuthStore, useProductStore } from '../../store/store'
import { BRAND_LOGO, BRAND_EN } from '../../lib/brand'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { ModalPortal } from '../ModalPortal'

const ACCENT_SWATCHES = [
  '#2E7D32', '#0F5132', '#1B5E20', '#DC2626', '#EA580C', '#B91C1C',
  '#7C3AED', '#4338CA', '#2563EB', '#0EA5E9', '#7C2D92', '#701A75',
  '#4C1D95', '#DB2777', '#BE185D', '#0D9488', '#0891B2', '#CA8A04',
  '#111111', '#374151',
]

export interface StoreSettingsViewProps {
  onAddProduct?: () => void
}

export default function StoreSettingsView({ onAddProduct }: StoreSettingsViewProps) {
  const { settings, loading, saving, fetchSettings, updateSettings, uploadLogo, clearLogo, changePassword } = useSettingsStore()
  const role = useAdminAuthStore(state => state.role)
  const products = useProductStore(state => state.products)
  const fetchProducts = useProductStore(state => state.fetchProducts)
  const [applyingThreshold, setApplyingThreshold] = useState(false)
  const [applyMsg, setApplyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Sets every product's own low-stock limit to the number in the box
  const applyThresholdToAll = async () => {
    const n = Math.max(0, Math.floor(Number(form.lowStockThreshold) || 0))
    if (!window.confirm(`Set the low stock alert to ${n} for all ${products.length} products?\n\nThis replaces any limit you set for an individual product.`)) return
    setApplyingThreshold(true)
    setApplyMsg(null)
    try {
      const { error } = await supabase.from('products').update({ low_stock_alert: n, updated_at: new Date().toISOString() }).not('id', 'is', null)
      if (error) throw error
      await fetchProducts(true)
      setApplyMsg({ type: 'ok', text: `All products now alert at ${n}.` })
    } catch (err) {
      setApplyMsg({ type: 'err', text: err instanceof Error ? err.message : 'Could not update the products' })
    } finally {
      setApplyingThreshold(false)
    }
  }

  const [form, setForm] = useState({
    name: '', ownerName: '', phone: '', shopContactNumber: '', email: '', address: '', instagramHandle: '',
    businessType: '', accentColor: '#2E7D32',
    gstEnabled: false, lowStockThreshold: 5, expiryAlertDays: 30,
  })
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoRemoving, setLogoRemoving] = useState(false)
  const [logoErr, setLogoErr] = useState('')
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [pwOpen, setPwOpen] = useState(false)
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSuccess, setPwSuccess] = useState(false)

  useEffect(() => { void fetchSettings() }, [fetchSettings])

  const formFromSettings = (s: NonNullable<typeof settings>) => ({
    name: s.name,
    ownerName: s.ownerName,
    phone: s.phone,
    shopContactNumber: s.shopContactNumber,
    email: s.email,
    address: s.address,
    instagramHandle: s.instagramHandle,
    businessType: s.businessType,
    accentColor: s.accentColor || '#2E7D32',
    gstEnabled: s.gstEnabled,
    lowStockThreshold: s.lowStockThreshold,
    expiryAlertDays: s.expiryAlertDays,
  })

  // Sync the editable form from freshly-fetched/updated settings. Done during
  // render (not in an effect) per React's "adjusting state when a prop
  // changes" pattern, so it doesn't trigger an extra cascading render pass.
  const [prevSettings, setPrevSettings] = useState(settings)
  if (settings !== prevSettings) {
    setPrevSettings(settings)
    if (settings) setForm(formFromSettings(settings))
  }

  const handleReset = () => {
    if (settings) setForm(formFromSettings(settings))
    setSaveMsg(null)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaveMsg(null)
    const { error } = await updateSettings({ ...form, instagramHandle: form.instagramHandle.trim().replace(/^@+/, '') })
    setSaveMsg(error ? { type: 'err', text: error } : { type: 'ok', text: 'Configuration saved.' })
    if (!error) setTimeout(() => setSaveMsg(null), 3000)
  }

  const handleLogoFile = async (file: File) => {
    setLogoErr('')
    if (file.size > 5_000_000) { setLogoErr('Image must be under 5 MB.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      setLogoErr('Only JPEG, PNG, WebP, or SVG images are accepted.'); return
    }
    setLogoUploading(true)
    const { error } = await uploadLogo(file)
    setLogoUploading(false)
    if (error) setLogoErr(error)
  }

  const handleRemoveLogo = async () => {
    setLogoErr('')
    setLogoRemoving(true)
    const { error } = await clearLogo()
    setLogoRemoving(false)
    if (error) setLogoErr(error)
  }

  const openPasswordModal = () => {
    setPwNew(''); setPwConfirm(''); setPwErr(''); setPwSuccess(false); setPwOpen(true)
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwErr('')
    if (pwNew.trim().length < 4) { setPwErr('Password must be at least 4 characters.'); return }
    if (pwNew !== pwConfirm) { setPwErr('Passwords do not match.'); return }
    if (!role) { setPwErr('No active role found.'); return }
    setPwSaving(true)
    const { error } = await changePassword(role, pwNew.trim())
    setPwSaving(false)
    if (error) { setPwErr(error); return }
    setPwSuccess(true)
    setTimeout(() => setPwOpen(false), 1500)
  }

  const logoSrc = settings?.logoUrl || BRAND_LOGO
  const hasCustomLogo = Boolean(settings?.logoUrl)

  const catalogueCategories = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      if (p.isActive === false) continue
      const cat = (p.category || '').trim()
      if (!cat || cat.toLowerCase() === 'unregistered') continue
      map.set(cat, (map.get(cat) || 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [products])
  const catalogueItemCount = catalogueCategories.reduce((sum, [, count]) => sum + count, 0)

  const instagramHandleClean = form.instagramHandle.trim().replace(/^@+/, '')

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] sm:text-[22px] font-black text-[#111111]">Store Settings</h2>
          <p className="text-[13px] text-[#6B7280] mt-1">Shop profile used across invoices, receipts and the app header.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#E5E7EB] rounded-xl text-[13px] font-bold text-[#111111] hover:bg-[#F9FAFB] transition-colors shadow-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reset
          </button>
          <button
            type="submit" form="store-settings-form" disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-white rounded-xl text-[13px] font-bold shadow-sm transition-colors disabled:opacity-60"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {saveMsg && (
        <span className={`inline-flex text-[12px] font-bold items-center gap-1.5 ${saveMsg.type === 'ok' ? 'text-[var(--accent)]' : 'text-red-600'}`}>
          {saveMsg.type === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />} {saveMsg.text}
        </span>
      )}

      {loading && !settings ? (
        <div className="p-10 text-center text-[13px] font-bold text-[#6B7280]">Loading settings...</div>
      ) : (
        <form id="store-settings-form" onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Shop Profile */}
            <SectionCard icon={Store} title="Shop Profile" subtitle="Logo, owner and shop name">
              <div className="flex items-center gap-4 mb-5">
                <div className="relative shrink-0">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden border border-[#E5E7EB]">
                    <img src={logoSrc} alt={BRAND_EN} className="w-full h-full object-cover" />
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handleLogoFile(f) }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading || !isSupabaseConfigured}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg text-[11px] font-black text-[#111111] hover:bg-[#F9FAFB] transition-colors disabled:opacity-60"
                  >
                    {logoUploading ? <RefreshCw size={12} className="animate-spin" /> : <Camera size={12} />} REPLACE LOGO
                  </button>
                  {hasCustomLogo && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveLogo()}
                      disabled={logoRemoving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-[11px] font-black text-red-600 hover:bg-red-100 transition-colors disabled:opacity-60"
                    >
                      <Trash2 size={12} /> REMOVE
                    </button>
                  )}
                  {logoErr && <p className="text-[11px] text-red-600">{logoErr}</p>}
                  {!isSupabaseConfigured && <p className="text-[11px] text-amber-700">Connect Supabase to enable logo uploads.</p>}
                </div>
              </div>
              <div className="space-y-3.5">
                <Field label="Full Name">
                  <input className={inputCls} value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} />
                </Field>
                <Field label="Shop Name">
                  <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </Field>
                <Field label="Business Type">
                  <input className={inputCls} placeholder="e.g. General Store / Provisions" value={form.businessType} onChange={e => setForm(f => ({ ...f, businessType: e.target.value }))} />
                </Field>
              </div>
            </SectionCard>

            {/* Contact Details */}
            <SectionCard icon={Phone} title="Contact Details" subtitle="Shop contact only — customer details are unaffected">
              <div className="space-y-3.5">
                <Field label="Phone Number">
                  <input className={inputCls} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </Field>
                <Field label="Shop Contact Number">
                  <input className={inputCls} value={form.shopContactNumber} onChange={e => setForm(f => ({ ...f, shopContactNumber: e.target.value }))} />
                </Field>
                <Field label="Email ID">
                  <input type="email" className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </Field>
              </div>
            </SectionCard>

            {/* Shop Information */}
            <SectionCard icon={MapPin} title="Shop Information" subtitle="Address and social profile">
              <div className="space-y-3.5">
                <Field label="Shop Address">
                  <textarea rows={3} className={`${inputCls} resize-none`} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </Field>
                <Field label="Instagram ID">
                  <div className={`${inputCls} flex items-center gap-1`}>
                    <span className="text-[#9CA3AF]">@</span>
                    <input
                      className="flex-1 bg-transparent outline-none"
                      value={instagramHandleClean}
                      onChange={e => setForm(f => ({ ...f, instagramHandle: e.target.value.replace(/^@+/, '') }))}
                    />
                  </div>
                  {instagramHandleClean && (
                    <a
                      href={`https://www.instagram.com/${instagramHandleClean}/`}
                      target="_blank" rel="noopener noreferrer"
                      className="mt-1.5 inline-block text-[11px] font-bold text-[var(--accent)] hover:underline break-all"
                    >
                      https://www.instagram.com/{instagramHandleClean}/
                    </a>
                  )}
                </Field>
              </div>
            </SectionCard>

            {/* Appearance */}
            <SectionCard icon={Palette} title="Appearance" subtitle="Preferred colour theme — selected card colour + white stays the app theme">
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 mb-4">
                {ACCENT_SWATCHES.map(hex => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, accentColor: hex }))}
                    className={`w-full aspect-square rounded-lg border-2 transition-transform hover:scale-105 ${form.accentColor.toLowerCase() === hex.toLowerCase() ? 'border-[#111111] ring-2 ring-offset-1 ring-[#111111]' : 'border-transparent'}`}
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                    title={hex}
                  />
                ))}
              </div>
              <Field label="Custom Colour">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9A-Fa-f]{6}$/.test(form.accentColor) ? form.accentColor : '#2E7D32'}
                    onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                    className="w-11 h-11 shrink-0 rounded-xl border border-[#E5E7EB] cursor-pointer bg-white p-1"
                  />
                  <input
                    className={`${inputCls} flex-1 uppercase`}
                    value={form.accentColor}
                    onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                    placeholder="#2E7D32"
                  />
                </div>
              </Field>
              <div className="mt-4 rounded-xl p-4 text-white" style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(form.accentColor) ? form.accentColor : '#2E7D32' }}>
                <p className="text-[10px] font-black uppercase tracking-wider opacity-80">Card Preview</p>
                <p className="text-[13px] font-bold mt-0.5">Selected colour + white stays the app theme.</p>
              </div>
              <p className="mt-3 text-[11px] text-[#9CA3AF]">
                White backgrounds, layout and components are unchanged — only the accent colour follows this setting.
              </p>
            </SectionCard>
          </div>

          {/* Product Catalogue */}
          <SectionCard icon={Package} title="Product Catalogue" subtitle="Uses the existing product & category system — nothing is duplicated">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                type="button"
                onClick={onAddProduct}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#111111] hover:bg-[#1A1A1A] text-white rounded-xl text-[12px] font-black transition-colors"
              >
                + ADD PRODUCT TO CATALOGUE
              </button>
              <span className="text-[12px] font-semibold text-[#6B7280]">{catalogueItemCount} items in the catalogue</span>
            </div>
            {catalogueCategories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {catalogueCategories.map(([name, count]) => (
                  <span key={name} className="px-3 py-1.5 rounded-full bg-[#F9FAFB] border border-[#E5E7EB] text-[11px] font-bold text-[#374151]">
                    {name} · {count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[#9CA3AF]">No products yet — add your first product from the Inventory screen.</p>
            )}
            <p className="mt-3 text-[11px] text-[#9CA3AF]">
              Product name, category, image, price and stock are managed on the existing inventory screen.
            </p>
          </SectionCard>

          {/* Billing & Inventory Thresholds */}
          <SectionCard icon={SlidersHorizontal} title="Billing & Inventory Thresholds">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex-1">
                <Field label="Default Low Stock Threshold">
                  <NumberInput
                    min={0} className={inputCls}
                    value={form.lowStockThreshold}
                    onCommit={n => setForm(f => ({ ...f, lowStockThreshold: n }))}
                  />
                </Field>
                <p className="text-[11px] text-[#6B7280] mt-1.5">Starting value for new products. Each product can have its own limit in Add / Edit Products, and that one is used for its alerts.</p>
                <button
                  type="button"
                  onClick={() => void applyThresholdToAll()}
                  disabled={applyingThreshold || !isSupabaseConfigured || products.length === 0}
                  className="mt-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-bold text-[#111111] hover:bg-[#F9FAFB] disabled:opacity-50 cursor-pointer disabled:cursor-default"
                >
                  {applyingThreshold ? 'Applying…' : `Apply ${form.lowStockThreshold} to all products`}
                </button>
                {applyMsg && (
                  <p className={`mt-1 text-[11px] font-semibold ${applyMsg.type === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{applyMsg.text}</p>
                )}
              </div>
              <div className="flex-1">
                <Field label="Expiry Alert Window (days)">
                  <NumberInput
                    min={1} className={inputCls}
                    value={form.expiryAlertDays}
                    onCommit={n => setForm(f => ({ ...f, expiryAlertDays: n }))}
                  />
                </Field>
                <p className="text-[11px] text-[#6B7280] mt-1.5">Products with an expiry date land in "Expiring Soon" once they're within this many days of it.</p>
              </div>
              <label className="flex items-start gap-2.5 sm:mt-6 cursor-pointer">
                <input
                  type="checkbox" checked={form.gstEnabled}
                  onChange={e => setForm(f => ({ ...f, gstEnabled: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-[13px] font-bold text-[#111111]">Enable GST Billing in POS</span>
                  <span className="block text-[11px] text-[#6B7280]">When enabled, GST line items are computed on invoices.</span>
                </span>
              </label>
            </div>
          </SectionCard>

          {/* Account Security */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB]/60 p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Lock size={16} className="text-[var(--accent)] shrink-0" />
              <div>
                <p className="text-[13px] font-black uppercase tracking-wider text-[var(--accent)]">Account Security</p>
                <p className="text-[12px] text-[#6B7280]">Update your {role || 'portal'} login password.</p>
              </div>
            </div>
            <button
              type="button" onClick={openPasswordModal}
              className="px-5 py-2.5 bg-[#0A0A0A] hover:bg-[#1A1A1A] text-white rounded-xl text-[13px] font-bold shadow-sm transition-colors shrink-0"
            >
              Change Password
            </button>
          </div>
        </form>
      )}

      {pwOpen && (
        <ModalPortal><div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setPwOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between p-4 border-b border-[#E5E7EB]">
              <h3 className="text-[14px] font-black text-[#111111]">Change Password</h3>
              <button type="button" onClick={() => setPwOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#F9FAFB] text-[#6B7280]">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="p-4 space-y-4">
              {pwSuccess ? (
                <p className="text-[13px] font-bold text-[var(--accent)] flex items-center gap-2"><Check size={16} /> Password updated.</p>
              ) : (
                <>
                  <Field label="New Password">
                    <input type="password" className={inputCls} value={pwNew} onChange={e => setPwNew(e.target.value)} autoFocus />
                  </Field>
                  <Field label="Confirm New Password">
                    <input type="password" className={inputCls} value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} />
                  </Field>
                  {pwErr && <p className="text-[12px] text-red-600">{pwErr}</p>}
                  <button
                    type="submit" disabled={pwSaving}
                    className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-white rounded-xl text-[13px] font-bold shadow-sm transition-colors disabled:opacity-60"
                  >
                    {pwSaving ? 'Saving...' : 'Update Password'}
                  </button>
                </>
              )}
            </form>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3.5 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB]/60 rounded-xl text-[13px] font-bold text-[#111111] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[var(--accent)] transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-black uppercase tracking-wider text-[#6B7280] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function SectionCard({ icon: Icon, title, subtitle, children }: { icon: typeof Store; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB]/60 p-4 sm:p-6 shadow-sm">
      <div className="flex items-start gap-2 mb-5">
        <Icon size={16} className="text-[var(--accent)] mt-0.5 shrink-0" />
        <div>
          <h3 className="text-[13px] font-black text-[#111111]">{title}</h3>
          {subtitle && <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * Whole-number box that can be cleared while typing. The number is selected on
 * focus so the first key replaces it; an empty or invalid entry goes back to the
 * last good value when the box is left.
 */
function NumberInput({ value, min, className, onCommit }: {
  value: number
  min: number
  className?: string
  onCommit: (n: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  return (
    <input
      type="number" inputMode="numeric" min={min} step={1} className={className}
      value={text}
      onFocus={e => e.target.select()}
      onChange={e => {
        const v = e.target.value
        setText(v)
        const n = Math.floor(Number(v))
        if (v.trim() !== '' && Number.isFinite(n) && n >= min) onCommit(n)
      }}
      onBlur={() => {
        const n = Math.floor(Number(text))
        if (text.trim() === '' || !Number.isFinite(n) || n < min) setText(String(value))
      }}
    />
  )
}
