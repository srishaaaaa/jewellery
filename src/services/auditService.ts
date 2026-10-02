import { supabase } from '../lib/supabase'
import { useAdminAuthStore } from '../store/store'
import { toNumber } from '../lib/retail'

/** Who is using the portal right now, e.g. "Admin (admin)" or "Staff (staff)". */
export const currentUserName = () => {
  const { role, adminId } = useAdminAuthStore.getState()
  return `${role === 'admin' ? 'Admin' : 'Staff'}${adminId ? ` (${adminId})` : ''}`
}

export type AuditEntry = {
  id: number
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  userName: string
  note: string
  createdAt: string
}

/** Readable names for audit actions. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  metal_rate_changed: 'Metal rate changed',
  product_created: 'Item added',
  product_updated: 'Item changed',
  product_deleted: 'Item deleted',
  price_changed: 'Price changed',
  stock_adjusted: 'Stock adjusted',
  invoice_deleted: 'Invoice deleted',
  record_deleted: 'Sales Desk record deleted',
  invoice_status_changed: 'Invoice status changed',
  bill_discount: 'Discount given on bill',
  return_created: 'Return / exchange recorded',
  return_approved: 'Return / exchange approved',
  return_rejected: 'Return / exchange rejected',
  scheme_rules_changed: 'Schema rules changed',
  scheme_cancelled: 'Scheme cancelled',
  scheme_transferred: 'Scheme transferred',
  advance_cancelled: 'Advance cancelled',
  settings_changed: 'Store settings changed',
}

export const auditService = {
  /**
   * Records a sensitive change. Never blocks the action itself: if the log
   * cannot be written (e.g. before the database update) it only warns.
   */
  async log(entry: { action: string; entityType?: string; entityId?: string | number; oldValue?: unknown; newValue?: unknown; note?: string }) {
    const { error } = await supabase.from('audit_logs').insert({
      action: entry.action,
      entity_type: entry.entityType || '',
      entity_id: entry.entityId != null ? String(entry.entityId) : '',
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      user_name: currentUserName(),
      note: entry.note || '',
    })
    if (error) console.warn('Audit log not written:', error.message)
  },

  async list(filter: { from?: string; to?: string; action?: string; limit?: number } = {}): Promise<AuditEntry[]> {
    let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(filter.limit ?? 500)
    if (filter.action) q = q.eq('action', filter.action)
    if (filter.from) q = q.gte('created_at', `${filter.from}T00:00:00`)
    if (filter.to) q = q.lte('created_at', `${filter.to}T23:59:59.999`)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data || []).map((r) => ({
      id: toNumber(r.id, 0),
      action: String(r.action || ''),
      entityType: String(r.entity_type || ''),
      entityId: String(r.entity_id || ''),
      oldValue: r.old_value,
      newValue: r.new_value,
      userName: String(r.user_name || ''),
      note: String(r.note || ''),
      createdAt: String(r.created_at || ''),
    }))
  },
}
