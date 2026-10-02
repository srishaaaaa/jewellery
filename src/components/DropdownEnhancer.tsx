import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

type Entry = { kind: 'group'; label: string } | { kind: 'option'; value: string; label: string; disabled: boolean }

/**
 * Makes every <select> in the app open its list DOWNWARD on computers.
 * A native <select> list opens wherever the browser decides (often upward near
 * the bottom of the screen). On mouse click this shows our own list just below
 * the select instead; picking an option sets the select's value and fires the
 * normal change event, so every screen keeps working unchanged.
 * Touch devices keep their native full-screen picker; the keyboard is untouched.
 * Add data-native="true" to a <select> to opt out.
 */
export function DropdownEnhancer() {
  const [target, setTarget] = useState<HTMLSelectElement | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 })
  const listRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLSelectElement | null>(null)
  useEffect(() => { targetRef.current = target }, [target])

  useEffect(() => {
    const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true
    if (!finePointer) return

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const select = (e.target as Element | null)?.closest?.('select') as HTMLSelectElement | null
      if (!select || select.multiple || select.size > 1 || select.disabled || select.dataset.native === 'true') return
      e.preventDefault()
      if (targetRef.current === select) { setTarget(null); return }
      // Make sure there is room below: bring a select near the bottom edge into view first
      if (window.innerHeight - select.getBoundingClientRect().bottom < 220) select.scrollIntoView({ block: 'center' })
      const r = select.getBoundingClientRect()
      const list: Entry[] = []
      for (const child of Array.from(select.children)) {
        if (child instanceof HTMLOptGroupElement) {
          list.push({ kind: 'group', label: child.label })
          for (const o of Array.from(child.children)) {
            if (o instanceof HTMLOptionElement && !o.hidden) list.push({ kind: 'option', value: o.value, label: o.text, disabled: o.disabled })
          }
        } else if (child instanceof HTMLOptionElement && !child.hidden) {
          list.push({ kind: 'option', value: child.value, label: child.text, disabled: child.disabled })
        }
      }
      select.focus()
      setEntries(list)
      setPos({
        left: Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 8),
        top: r.bottom + 4,
        width: Math.max(r.width, 160),
        maxHeight: Math.max(160, Math.min(320, window.innerHeight - r.bottom - 12)),
      })
      setTarget(select)
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [])

  useEffect(() => {
    if (!target) return
    const close = () => setTarget(null)
    const onDown = (e: MouseEvent) => {
      if (listRef.current?.contains(e.target as Node) || e.target === target) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Tab') close() }
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    // Ignore the scroll caused by bringing the select into view just before opening
    const t = window.setTimeout(() => window.addEventListener('scroll', onScroll, true), 150)
    window.addEventListener('resize', close)
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [target])

  if (!target) return null

  const choose = (value: string) => {
    // Set the value the way React expects, then fire the normal change event
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(target, value)
    target.dispatchEvent(new Event('change', { bubbles: true }))
    setTarget(null)
  }

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, zIndex: 100000 }}
      className="overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1 shadow-2xl"
    >
      {entries.map((entry, i) =>
        entry.kind === 'group' ? (
          <div key={`g${i}`} className="px-3.5 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">{entry.label}</div>
        ) : (
          <button
            key={`o${i}`}
            type="button"
            role="option"
            aria-selected={entry.value === target.value}
            disabled={entry.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(entry.value)}
            className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default ${
              entry.value === target.value ? 'bg-[var(--accent)] text-white' : 'text-gray-800 hover:bg-gray-100'
            }`}
          >
            <span className="truncate">{entry.label}</span>
            {entry.value === target.value && <Check size={13} className="shrink-0" />}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
