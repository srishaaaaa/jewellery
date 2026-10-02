import { supabase } from '../lib/supabase'

export interface CustomerRecord {
  id: string
  phone: string
  name: string
  address: string
  birthday: string | null
  anniversary: string | null
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
    const { data, error } = await supabase
      .from('customers')
      .select('id, phone, name, address, birthday, anniversary')
      .eq('phone', phone.trim())
      .maybeSingle()

    if (error) {
      console.error('[customerService.findByPhone] Error:', error)
      return null
    }
    return data
  },

  /**
   * Upsert a customer record from a completed POS sale. Blank birthday/
   * anniversary/name/address never overwrite a previously-saved value —
   * only non-blank fields from this sale are applied.
   */
  async upsertFromSale(input: { phone: string; name?: string; address?: string; birthday?: string | null; anniversary?: string | null }): Promise<void> {
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
    const { data, error } = await supabase
      .from('customers')
      .select('id, phone, name, address, birthday, anniversary')
      .order('name', { ascending: true })

    if (error) {
      console.error('[customerService.fetchAll] Error:', error)
      return []
    }
    return data || []
  },

  /**
   * Create a new customer record from the management screen. Throws a
   * friendly error if the phone number is already registered.
   */
  async create(input: { phone: string; name: string; address?: string; birthday?: string | null; anniversary?: string | null }): Promise<CustomerRecord> {
    const phone = input.phone.trim()
    const { data, error } = await supabase
      .from('customers')
      .insert({
        phone,
        name: input.name.trim(),
        address: input.address?.trim() || '',
        birthday: input.birthday || null,
        anniversary: input.anniversary || null,
      })
      .select('id, phone, name, address, birthday, anniversary')
      .single()

    if (error) {
      if (error.code === '23505') throw new Error('This phone number is already registered to another customer.')
      throw error
    }
    return data
  },

  /**
   * Update an existing customer record from the management screen.
   */
  async update(id: string, input: { phone: string; name: string; address?: string; birthday?: string | null; anniversary?: string | null }): Promise<void> {
    const { error } = await supabase
      .from('customers')
      .update({
        phone: input.phone.trim(),
        name: input.name.trim(),
        address: input.address?.trim() || '',
        birthday: input.birthday || null,
        anniversary: input.anniversary || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      if (error.code === '23505') throw new Error('This phone number is already registered to another customer.')
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
