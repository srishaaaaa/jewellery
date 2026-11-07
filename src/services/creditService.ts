import { supabase } from '../lib/supabase'
import { toLocalDateStr } from '../lib/dateRanges'

export interface OutstandingCreditOrder {
  id: string
  invoice_no: string
  customer_name: string
  phone: string
  total: number
  created_at: string
  billing_date: string | null
  credit_due_date: string | null
  daysOverdue: number
}

const OUTSTANDING_COLUMNS = 'id, invoice_no, customer_name, phone, total, created_at, billing_date, credit_due_date'

export function toDaysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(`${dueDate}T00:00:00`)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((today.getTime() - due.getTime()) / msPerDay)
}

export const creditService = {
  /**
   * Fetch every outstanding (unpaid) credit sale, oldest due date first.
   */
  async fetchOutstandingCredits(): Promise<OutstandingCreditOrder[]> {
    const { data, error } = await supabase
      .from('orders')
      .select(OUTSTANDING_COLUMNS)
      .eq('credit_status', 'outstanding')
      .order('credit_due_date', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('[creditService.fetchOutstandingCredits] Error:', error)
      throw error
    }

    return (data || []).map((row) => ({
      ...row,
      daysOverdue: toDaysOverdue(row.credit_due_date),
    }))
  },

  /**
   * Lightweight count of outstanding credit sales whose due date has arrived
   * or passed, for the sidebar badge.
   */
  async fetchOverdueCount(): Promise<number> {
    const today = toLocalDateStr(new Date())
    const { count, error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('credit_status', 'outstanding')
      .lte('credit_due_date', today)

    if (error) {
      console.error('[creditService.fetchOverdueCount] Error:', error)
      return 0
    }

    return count || 0
  },

  /**
   * Settle an outstanding credit sale: marks it paid and stamps when.
   */
  async markAsPaid(orderId: string, method?: string, note = ''): Promise<void> {
    if (method) {
      const { error } = await supabase.rpc('settle_credit_order', { p_order_id: orderId, p_method: method, p_note: note })
      if (!error) return
      // Database not updated yet: settle without the payment details.
      if (!/settle_credit_order|function/i.test(error.message || '')) throw error
    }
    const { error } = await supabase.rpc('mark_credit_order_paid', { p_order_id: orderId })
    if (error) {
      console.error('[creditService.markAsPaid] Error:', error)
      throw error
    }
  },

  /**
   * Records money received for a credit bill: the whole balance or part of it. The bill is marked
   * paid once the payments reach its total. Returns what is still owed.
   */
  async recordPayment(orderId: string, amount: number, method: string, note = '', fullBalance = false): Promise<{ balance: number; fullyPaid: boolean }> {
    const { data, error } = await supabase.rpc('record_credit_payment', { p_order_id: orderId, p_amount: amount, p_method: method, p_note: note, p_by: 'Admin' })
    if (!error) {
      const r = (data || {}) as { balance?: number; fully_paid?: boolean }
      return { balance: Number(r.balance) || 0, fullyPaid: r.fully_paid === true }
    }
    // Database not updated yet: only a full settlement can be saved the old way.
    if (/record_credit_payment|PGRST202|function/i.test(`${error.message} ${error.code}`)) {
      if (!fullBalance) throw new Error('Part payments need the database update: run supabase/migrations/customer_portal.sql.')
      await this.markAsPaid(orderId, method, note)
      return { balance: 0, fullyPaid: true }
    }
    throw new Error(error.message)
  },

  /** Payments recorded for one credit bill, oldest first. */
  async payments(orderId: string): Promise<Array<{ id: string; amount: number; payment_method: string; reference: string; utr: string; created_at: string }>> {
    const { data, error } = await supabase.from('order_payments').select('id, amount, payment_method, reference, utr, created_at').eq('order_id', orderId).order('created_at', { ascending: true })
    if (error) return []
    return (data || []).map((r) => ({ ...r, amount: Number(r.amount) || 0, reference: String(r.reference || ''), utr: String(r.utr || '') }))
  },

  /**
   * Reschedule an outstanding credit sale's due date (e.g. the customer
   * asked for more time). Only meaningful while credit_status is 'outstanding'.
   */
  async updateDueDate(orderId: string, dueDate: string): Promise<void> {
    const { error } = await supabase.from('orders').update({ credit_due_date: dueDate }).eq('id', orderId)
    if (error) {
      console.error('[creditService.updateDueDate] Error:', error)
      throw error
    }
  },
}
