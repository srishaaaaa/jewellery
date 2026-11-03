/** How early a due item starts showing in the alerts: on the day, a week before, a month before, or never. */
export type AlertLead = 'off' | 'day' | 'week' | 'month'
export type AlertKind = 'credit' | 'advance' | 'scheme' | 'purchase' | 'repair' | 'birthday' | 'anniversary' | 'quotation' | 'certificate' | 'stock'

export interface AlertSettings {
  /** Pop-up (and phone / desktop notification) when something is due. Off = no alerts at all. */
  notifications: boolean
  /** Alarm sound with the pop-up. Off = pop-up only. */
  sound: boolean
  leads: Record<AlertKind, AlertLead>
}

export const ALERT_KINDS: Array<[AlertKind, string, string]> = [
  ['credit', 'Credit payments', 'Credit bills reaching their due date'],
  ['advance', 'Advance orders', 'Expected delivery date of advance orders'],
  ['scheme', 'Scheme installments', 'Next installment due on savings schemes'],
  ['purchase', 'Supplier balances', 'Balance due date on supplier purchases'],
  ['repair', 'Repairs', 'Expected ready date of repairs'],
  ['birthday', 'Customer birthdays', 'Birthdays saved on customers (send wishes on WhatsApp)'],
  ['anniversary', 'Customer anniversaries', 'Anniversaries saved on customers (send wishes on WhatsApp)'],
  ['quotation', 'Quotations expiring', 'Open quotations reaching their "valid until" date'],
  ['certificate', 'Certificates expiring', 'Stone certificates reaching their expiry date'],
  ['stock', 'Low stock', 'Items at or below their low-stock limit (Off = no low-stock alarm)'],
]

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  notifications: true,
  sound: true,
  leads: { credit: 'day', advance: 'week', scheme: 'day', purchase: 'week', repair: 'day', birthday: 'day', anniversary: 'day', quotation: 'day', certificate: 'month', stock: 'day' },
}

export const LEAD_DAYS: Record<AlertLead, number> = { off: -1, day: 0, week: 7, month: 30 }

export const LEAD_LABELS: Record<AlertLead, string> = { off: 'Off', day: 'On the day', week: '1 week before', month: '1 month before' }

export const normalizeAlertSettings = (raw: unknown): AlertSettings => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const leads = r.leads && typeof r.leads === 'object' ? (r.leads as Record<string, unknown>) : {}
  const lead = (k: AlertKind): AlertLead => (['off', 'day', 'week', 'month'].includes(String(leads[k])) ? (leads[k] as AlertLead) : DEFAULT_ALERT_SETTINGS.leads[k])
  return {
    notifications: typeof r.notifications === 'boolean' ? r.notifications : DEFAULT_ALERT_SETTINGS.notifications,
    sound: typeof r.sound === 'boolean' ? r.sound : DEFAULT_ALERT_SETTINGS.sound,
    leads: { credit: lead('credit'), advance: lead('advance'), scheme: lead('scheme'), purchase: lead('purchase'), repair: lead('repair'), birthday: lead('birthday'), anniversary: lead('anniversary'), quotation: lead('quotation'), certificate: lead('certificate'), stock: lead('stock') },
  }
}
