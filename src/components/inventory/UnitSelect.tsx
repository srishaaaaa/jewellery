import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { UNIT_OPTIONS, UNIT_GROUPS } from '../../lib/units'

/**
 * Unit picker that always opens downward (a native <select> flips upward
 * when the browser thinks there is more room above).
 */
export function UnitSelect({ value, onChange, className = '' }: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = UNIT_OPTIONS.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // Bring the selected option into view inside the list, and the list into view on the page
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative w-full sm:max-w-xs ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full h-10 px-3.5 rounded-xl border bg-white text-xs font-bold text-gray-900 outline-none flex items-center justify-between gap-2 touch-manipulation cursor-pointer ${open ? 'border-[#0A0A0A]' : 'border-gray-300'}`}
      >
        <span className="truncate">{selected?.label || 'Select unit'}</span>
        <ChevronDown size={15} className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-40 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
        >
          {UNIT_GROUPS.map((group) => (
            <div key={group}>
              <div className="px-3.5 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">{group}</div>
              {UNIT_OPTIONS.filter((o) => o.group === group).map((o) => {
                const isSel = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => { onChange(o.value); setOpen(false) }}
                    className={`w-full flex items-center justify-between px-5 py-2 text-left text-xs font-bold cursor-pointer ${isSel ? 'bg-[var(--accent)] text-white' : 'text-gray-800 hover:bg-gray-100'}`}
                  >
                    {o.label}
                    {isSel && <Check size={13} />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
