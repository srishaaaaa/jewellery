import { supabase } from '../lib/supabase'
import { isMissingSchemaError } from './productService'

export interface CustomerRecord {
  id: string
  phone: string
  name: string
  address: string
  birthday: string | null
  anniversary: string | null
  email?: string
  /** 12-digit Aadhaar, saved once given and filled in on later bills */
  aadhaar?: string | null
  pan?: string | null
  /** Customer agrees to reminders and offers (default yes) */
  allowOffers?: boolean
  notes?: string
}

const BASE_COLUMNS = 'id, phone, name, address, birthday, anniversary'
const EXTRA_COLUMNS = `${BASE_COLUMNS}, email, aadhaar, pan, allow_offers, notes`

const mapCustomer = (r: Record<string, unknown>): CustomerRecord => ({
  id: String(r.id), phone: String(r.phone || ''), name: String(r.name || ''), address: String(r.address || ''),
  birthday: r.birthday ? String(r.birthday) : null, anniversary: r.anniversary ? String(r.anniversary) : null,
  email: String(r.email || ''), aadhaar: r.aadhaar ? String(r.aadhaar) : null, pan: r.pan ? String(r.pan) : null,
  allowOffers: r.allow_offers !== false, notes: String(r.notes || ''),
})

/** Select with the KYC / offers columns, falling back to the original ones before the database update. */
async function selectCustomers<T>(run: (columns: string) => PromiseLike<{ data: T | null; error: unknown }>): Promise<{ data: T | null; error: unknown }> {
  const first = await run(EXTRA_COLUMNS)
  if (!first.error || !isMissingSchemaError(first.error)) return first
  return run(BASE_COLUMNS)
}

/** KYC / offers fields for an insert or update; only sent when given, so saving works before the database update. */
const extraFields = (input: { email?: string; aadhaar?: string | null; pan?: string | null; allowOffers?: boolean; notes?: string }) => ({
  ...(input.email !== undefined ? { email: input.email.trim() } : {}),
  ...(input.aadhaar !== undefined ? { aadhaar: normalizeAadhaar(input.aadhaar) || null } : {}),
  ...(input.pan !== undefined ? { pan: input.pan?.trim().toUpperCase() || null } : {}),
  ...(input.allowOffers !== undefined ? { allow_offers: input.allowOffers } : {}),
  ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
})

/** Aadhaar digits only ("1234 5678 9012" -> "123456789012"). */
export const normalizeAadhaar = (v: string | null | undefined) => String(v || '').replace(/\D/g, '')
export const isValidAadhaar = (v: string | null | undefined) => /^[2-9][0-9]{11}$/.test(normalizeAadhaar(v))
export const isValidPan = (v: string | null | undefined) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(v || '').trim().toUpperCase())
/** "XXXX XXXX 9012" — Aadhaar is never shown or printed in full. */
export const maskAadhaar = (v: string | null | undefined) => {
  const d = normalizeAadhaar(v)
  return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : ''
}

export interface CustomerEvent {
  id: string
  customerId: string
  name: string
  phone: string
  type: 'birthday' | 'anniversary'
}

function isTodayMonthDay(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date()
  const d = new Date(`${dateStr}T00:00:00`)
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
}

/** Local (not UTC) yyyy-mm-dd for "today", to match what a DATE column stores. */
function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const customerService = {
  /**
   * Look up a customer by phone (used to prefill the POS checkout form).
   */
  async findByPhone(phone: string): Promise<CustomerRecord | null> {
    if (!phone.trim()) return null
    const { data, error } = await selectCustomers((columns) => supabase
      .from('customers')
      .select(columns)
      .eq('phone', phone.trim())
      .maybeSingle())

    if (error) {
      console.error('[customerService.findByPhone] Error:', error)
      return null
    }
    return data ? mapCustomer(data as unknown as Record<string, unknown>) : null
  },

  /**
   * Upsert a customer record from a completed POS sale. Blank birthday/
   * anniversary/name/address never overwrite a previously-saved value —
   * only non-blank fields from this sale are applied.
   */
  async upsertFromSale(input: { phone: string; name?: string; address?: string; birthday?: string | null; anniversary?: string | null; aadhaar?: string | null; pan?: string | null }): Promise<void> {
    const phone = input.phone.trim()
    if (!phone) return

    const existing = await this.findByPhone(phone)

    const payload = {
      phone,
      name: input.name?.trim() || existing?.name || '',
      address: input.address?.trim() || existing?.address || '',
      birthday: input.birthday?.trim() || existing?.birthday || null,
      anniversary: input.anniversary?.trim() || existing?.anniversary || null,
      updated_at: new Date().toISOString(),
      // Aadhaar / PAN given on this bill are kept for next time (blank never clears a saved one).
      ...(normalizeAadhaar(input.aadhaar) ? { aadhaar: normalizeAadhaar(input.aadhaar) } : {}),
      ...(input.pan?.trim() ? { pan: input.pan.trim().toUpperCase() } : {}),
    }

    const { error } = await supabase.from('customers').upsert(payload, { onConflict: 'phone' })
    if (error) {
      console.error('[customerService.upsertFromSale] Error:', error)
    }
  },

  /**
   * Fetch every customer whose birthday or anniversary falls today
   * (year-independent), for the reminder alarm. Skips an occasion already
   * ticked/wished today, so it doesn't re-fire on every login.
   */
  async fetchTodaysEvents(): Promise<CustomerEvent[]> {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, birthday, anniversary, birthday_wish_sent_on, anniversary_wish_sent_on')
      .or('birthday.not.is.null,anniversary.not.is.null')

    if (error) {
      console.error('[customerService.fetchTodaysEvents] Error:', error)
      return []
    }

    const today = todayIso()
    const events: CustomerEvent[] = []
    for (const row of data || []) {
      if (isTodayMonthDay(row.birthday) && row.birthday_wish_sent_on !== today) {
        events.push({ id: `${row.id}-birthday`, customerId: row.id, name: row.name || 'Customer', phone: row.phone, type: 'birthday' })
      }
      if (isTodayMonthDay(row.anniversary) && row.anniversary_wish_sent_on !== today) {
        events.push({ id: `${row.id}-anniversary`, customerId: row.id, name: row.name || 'Customer', phone: row.phone, type: 'anniversary' })
      }
    }
    return events
  },

  /**
   * Marks a birthday/anniversary notification as dismissed for today —
   * ticked directly, or implied by sending the WhatsApp wish. Won't re-fire
   * again until the same occasion comes around next year.
   */
  async acknowledgeEvent(customerId: string, type: 'birthday' | 'anniversary'): Promise<void> {
    const column = type === 'birthday' ? 'birthday_wish_sent_on' : 'anniversary_wish_sent_on'
    const { error } = await supabase
      .from('customers')
      .update({ [column]: todayIso() })
      .eq('id', customerId)

    if (error) {
      console.error('[customerService.acknowledgeEvent] Error:', error)
      throw error
    }
  },

  /**
   * Fetch every customer that has at least a name or phone (used by the
   * Birthdays & Anniversaries management screen).
   */
  async fetchAll(): Promise<CustomerRecord[]> {
    const { data, error } = await selectCustomers((columns) => supabase
      .from('customers')
      .select(columns)
      .order('name', { ascending: true }))

    if (error) {
      console.error('[customerService.fetchAll] Error:', error)
      return []
    }
    return ((data || []) as unknown as Array<Record<string, unknown>>).map(mapCustomer)
  },

  /**
   * Create a new customer record from the management screen. Throws a
   * friendly error if the phone number is already registered.
   */
  async create(input: { phone: string; name: string; address?: string; birthday?: string | null; anniversary?: string | null; email?: string; aadhaar?: string | null; pan?: string | null; allowOffers?: boolean; notes?: string }): Promise<CustomerRecord> {
    const phone = input.phone.trim()
    const { data, error } = await supabase
      .from('customers')
      .insert({
        phone,
        name: input.name.trim(),
        address: input.address?.trim() || '',
        birthday: input.birthday || null,
        anniversary: input.anniversary || null,
        ...extraFields(input),
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') throw new Error('This phone number is already registered to another customer.')
      if (isMissingSchemaError(error)) throw new Error('Aadhaar, PAN, email and offers need the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.')
      throw error
    }
    return mapCustomer(data as Record<string, unknown>)
  },

  /**
   * Update an existing customer record from the management screen.
   */
  async update(id: string, input: { phone: string; name: string; address?: string; birthday?: string | null; anniversary?: string | null; email?: string; aadhaar?: string | null; pan?: string | null; allowOffers?: boolean; notes?: string }): Promise<void> {
    const { error } = await supabase
      .from('customers')
      .update({
        phone: input.phone.trim(),
        name: input.name.trim(),
        address: input.address?.trim() || '',
        birthday: input.birthday || null,
        anniversary: input.anniversary || null,
        updated_at: new Date().toISOString(),
        ...extraFields(input),
      })
      .eq('id', id)

    if (error) {
      if (error.code === '23505') throw new Error('This phone number is already registered to another customer.')
      if (isMissingSchemaError(error)) throw new Error('Aadhaar, PAN, email and offers need the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.')
      throw error
    }
  },

  /**
   * Delete a customer record from the management screen.
   */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) throw error
  },
}
