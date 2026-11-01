import { PAYMENT_MODES, SPLIT_MODES, paymentModeLabel, splitTotal, type PaymentMode, type SplitAmounts } from '../lib/paymentModes'

/**
 * Cash / UPI / Card / Bank / Cheque / Mixed buttons. With Mixed, one amount box per mode
 * appears and the running total is checked against `total`.
 */
export function PaymentModePicker({ mode, onMode, split, onSplit, total, label = 'Payment Mode' }: {
  mode: PaymentMode
  onMode: (mode: PaymentMode) => void
  split: SplitAmounts
  onSplit: (split: SplitAmounts) => void
  total: number
  label?: string
}) {
  const entered = splitTotal(split)
  const left = Math.round((total - entered) * 100) / 100
  return (
    <div>
      <p className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {PAYMENT_MODES.map(m => (
          <button key={m} type="button" onClick={() => onMode(m)}
            className={`py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.12em] border-2 transition-colors cursor-pointer ${mode === m ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'bg-white text-[#000000] border-black/10 hover:border-black/25'}`}>
            {paymentModeLabel(m)}
          </button>
        ))}
      </div>
      {mode === 'mixed' && (
        <div className="mt-3 rounded-xl border border-black/10 bg-[#FAFAFA] p-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SPLIT_MODES.map(m => (
              <label key={m} className="block">
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-[#000000]/70">{paymentModeLabel(m)}</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={split[m] ?? ''} placeholder="0"
                  onChange={e => onSplit({ ...split, [m]: e.target.value })}
                  onWheel={e => e.currentTarget.blur()}
                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-bold text-[#000000] focus:border-[var(--accent)] focus:outline-none" />
              </label>
            ))}
          </div>
          <p className={`text-[11px] font-bold ${left === 0 ? 'text-emerald-700' : 'text-[#B45309]'}`}>
            Entered ₹{entered.toLocaleString('en-IN', { maximumFractionDigits: 2 })} of ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            {left === 0 ? ' — matches' : left > 0 ? ` — ₹${left.toLocaleString('en-IN', { maximumFractionDigits: 2 })} still to split` : ` — ₹${Math.abs(left).toLocaleString('en-IN', { maximumFractionDigits: 2 })} too much`}
          </p>
        </div>
      )}
    </div>
  )
}
