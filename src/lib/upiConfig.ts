import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type UpiConfig = { upiId: string; upiName: string; rotateMinutes: number }

let cache: { at: number; value: UpiConfig | null } | null = null
const listeners = new Set<(v: UpiConfig | null) => void>()

/** Shop UPI details (Settings -> Guests Paying by UPI). The same values drive the counter QR and the customer pages. */
export async function loadUpiConfig(force = false): Promise<UpiConfig | null> {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.value
  const { data, error } = await supabase.from('store_settings').select('upi_id, upi_name, upi_rotate_minutes, name').eq('id', 1).maybeSingle()
  const row = (data || {}) as { upi_id?: string; upi_name?: string; upi_rotate_minutes?: number; name?: string }
  const value = error || !row.upi_id ? null : { upiId: row.upi_id, upiName: row.upi_name || row.name || '', rotateMinutes: Number(row.upi_rotate_minutes) || 5 }
  cache = { at: Date.now(), value }
  listeners.forEach((l) => l(value))
  return value
}

export function useUpiConfig() {
  const [value, setValue] = useState<UpiConfig | null>(cache?.value ?? null)
  useEffect(() => {
    listeners.add(setValue)
    void loadUpiConfig()
    return () => { listeners.delete(setValue) }
  }, [])
  return value
}
