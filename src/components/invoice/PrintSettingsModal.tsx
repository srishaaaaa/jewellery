import { useState } from 'react'
import { Printer, X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { loadPrintPrefs, savePrintPrefs, type PrintPrefs, type PrintSize } from '../../lib/printPrefs'

const choice = (active: boolean) =>
  `rounded-xl border-2 font-bold transition-all cursor-pointer ${active ? 'border-[var(--accent)] bg-[var(--accent-a5)] text-[var(--accent)]' : 'border-neutral-200 hover:border-neutral-300 text-neutral-600'}`

/** "Print Settings": thermal roll (58 / 80 mm) or sheet (A4 / A5). Remembers the last choice. */
export function PrintSettingsModal({ onClose, onPrint }: { onClose: () => void; onPrint: (prefs: PrintPrefs) => void }) {
  const [prefs, setPrefs] = useState<PrintPrefs>(loadPrintPrefs)
  const sizes: [PrintSize, string][] = prefs.paper === 'thermal' ? [['58', '58 mm'], ['80', '80 mm']] : [['a4', 'A4 Sheet'], ['a5', 'A5 Sheet']]

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
              <Printer className="w-4 h-4 text-neutral-300" />
              Print Settings
            </h3>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-6 p-6">
            <div>
              <label className="mb-3 block text-xs font-black uppercase tracking-wider text-black">Printer Type</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setPrefs({ paper: 'thermal', size: prefs.size === 'a4' || prefs.size === 'a5' ? '80' : prefs.size })} className={`p-3 text-sm ${choice(prefs.paper === 'thermal')}`}>Thermal Roll</button>
                <button type="button" onClick={() => setPrefs({ paper: 'sheet', size: prefs.size === '58' || prefs.size === '80' ? 'a4' : prefs.size })} className={`p-3 text-sm ${choice(prefs.paper === 'sheet')}`}>Sheet (A4/A5)</button>
              </div>
            </div>
            <div>
              <label className="mb-3 block text-xs font-black uppercase tracking-wider text-black">Paper Size</label>
              <div className="grid grid-cols-2 gap-3">
                {sizes.map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setPrefs({ ...prefs, size: value })} className={`py-2 text-xs !rounded-lg ${choice(prefs.size === value)}`}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
            <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-neutral-600 hover:bg-neutral-200 transition-colors cursor-pointer">Cancel</button>
            <button
              type="button"
              onClick={() => { savePrintPrefs(prefs); onClose(); onPrint(prefs) }}
              className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md hover:bg-[var(--accent-dark)] transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print Now
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
