import { useState } from 'react'
import { Save, CheckCircle2, AlertTriangle } from 'lucide-react'
import { SAMPLE_CUSTOMER_NAME, renderEventMessage, type useEventOfferSettings } from '../../lib/eventOfferSettings'

type Props = {
  title: string
  tone: 'pink' | 'rose'
  offerSettings: ReturnType<typeof useEventOfferSettings>
}

const TONES = {
  pink: { panel: 'bg-pink-50', icon: 'bg-pink-200', ring: 'focus:ring-pink-500', border: 'border-pink-500', btn: 'bg-pink-500 hover:bg-pink-600', dashed: 'border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100' },
  rose: { panel: 'bg-rose-50', icon: 'bg-rose-200', ring: 'focus:ring-rose-500', border: 'border-rose-500', btn: 'bg-rose-500 hover:bg-rose-600', dashed: 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100' },
}

/** Offer picker + message template + preview + Save, shared by the Birthday and Anniversary pages. */
export default function EventOfferPanel({ title, tone, offerSettings }: Props) {
  const t = TONES[tone]
  const { draft, setDraft, isDirty, save, saving, status, template } = offerSettings
  const [editingOffer, setEditingOffer] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [editingMessage, setEditingMessage] = useState(false)
  const [messageToEdit, setMessageToEdit] = useState('')

  const setOffers = (offers: string[], selectedOffer = draft.selectedOffer) =>
    setDraft({ ...draft, offers, selectedOffer: offers.includes(selectedOffer) ? selectedOffer : offers[0] || '' })

  const handleSaveEdit = () => {
    const value = editingValue.trim()
    if (editingOffer && value) {
      setOffers(draft.offers.map(o => (o === editingOffer ? value : o)), draft.selectedOffer === editingOffer ? value : draft.selectedOffer)
      setEditingOffer(null)
    }
  }

  const handleDeleteOffer = (offer: string) => {
    if (draft.offers.length <= 1) return
    setOffers(draft.offers.filter(o => o !== offer))
  }

  const handleAddOffer = () => {
    const newOffer = prompt('Enter new offer (e.g., "50% OFF", "Free Shipping", etc.)')?.trim()
    if (newOffer && !draft.offers.includes(newOffer)) setOffers([...draft.offers, newOffer], newOffer)
  }

  const preview = renderEventMessage(template, SAMPLE_CUSTOMER_NAME, draft.selectedOffer)

  return (
    <div className={`rounded-2xl border border-[#E5E7EB] ${t.panel} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${t.icon} flex items-center justify-center font-bold text-lg`}>🎁</div>
          <div>
            <h3 className="font-bold text-[#273126]">{title}</h3>
            <p className="text-xs text-[#6B7280]">Sent on WhatsApp when you tap "Send Offer".</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && !isDirty && (
            <span className={`flex items-center gap-1 text-[11px] font-bold ${status.type === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>
              {status.type === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {status.text}
            </span>
          )}
          {isDirty && <span className="text-[11px] font-bold text-amber-700">Unsaved changes</span>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 rounded-lg bg-[#0A0A0A] px-3.5 py-2 text-xs font-black text-white hover:bg-[#1A1A1A] disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="mb-4 space-y-2">
        <label className="block text-xs font-bold text-[#6B7280]">SELECT OFFER</label>
        {editingOffer ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              className={`w-full rounded-lg border ${t.border} bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 ${t.ring}`}
              placeholder="Enter offer text"
            />
            <div className="flex gap-2">
              <button onClick={handleSaveEdit} className={`flex-1 px-3 py-2 rounded-lg ${t.btn} text-white font-bold text-sm`}>
                Done
              </button>
              <button onClick={() => setEditingOffer(null)} className="flex-1 px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#111111] font-bold text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={draft.selectedOffer}
                onChange={(e) => setDraft({ ...draft, selectedOffer: e.target.value })}
                className={`flex-1 min-w-0 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111111] focus:outline-none focus:ring-2 ${t.ring}`}
              >
                {draft.offers.map((offer) => (
                  <option key={offer} value={offer}>{offer}</option>
                ))}
              </select>
              <button
                onClick={() => { setEditingOffer(draft.selectedOffer); setEditingValue(draft.selectedOffer) }}
                className="px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white font-bold text-sm hover:bg-gray-50 transition-colors"
                title="Edit selected offer"
              >
                ✏️
              </button>
              <button
                onClick={() => handleDeleteOffer(draft.selectedOffer)}
                disabled={draft.offers.length <= 1}
                className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 font-bold text-sm text-red-700 transition-colors disabled:opacity-40"
                title="Delete selected offer"
              >
                🗑️
              </button>
            </div>
            <button onClick={handleAddOffer} className={`w-full px-3 py-2 rounded-lg border border-dashed ${t.dashed} font-bold text-xs transition-colors`}>
              + Add Offer
            </button>
          </div>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-xs font-bold text-[#6B7280] mb-2">CUSTOMIZE MESSAGE</label>
        <textarea
          value={draft.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
          placeholder="Leave blank to use default message"
          className={`w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 ${t.ring}`}
          rows={3}
        />
        <p className="mt-1 text-[10px] text-[#6B7280]">Use <b>{'{name}'}</b> for the customer's name and <b>{'{offer}'}</b> for the selected offer.</p>
      </div>

      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-[#6B7280]">MESSAGE PREVIEW</p>
          {!editingMessage && (
            <button
              onClick={() => { setEditingMessage(true); setMessageToEdit(template) }}
              className="px-2 py-1 rounded text-xs font-bold text-green-700 hover:bg-green-100 transition-colors"
              title="Edit message"
            >
              ✏️ Edit
            </button>
          )}
        </div>
        {editingMessage ? (
          <div className="space-y-2">
            <textarea
              value={messageToEdit}
              onChange={(e) => setMessageToEdit(e.target.value)}
              className="w-full rounded-lg border border-green-500 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500"
              rows={8}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { void save({ message: messageToEdit }); setEditingMessage(false) }}
                className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white font-bold text-sm hover:bg-green-700"
              >
                Save Message
              </button>
              <button onClick={() => setEditingMessage(false)} className="flex-1 px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#111111] font-bold text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[#111111] whitespace-pre-wrap leading-relaxed break-words">{preview}</div>
        )}
      </div>
    </div>
  )
}
