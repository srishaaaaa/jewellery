import { createElement } from 'react'
import { Invoice, type InvoiceProps } from '../components/Invoice'
import { formatInvoiceNo } from './retail'
import { elementToPdfFile, sheetPdfFile } from './sheetPdf'

export type InvoicePdfData = {
  invoiceNo: string
  date: string
  customerName: string
  phone: string
  address: string
  items: Array<Record<string, unknown>>
  subtotal: number
  shipping: number
  total: number
  discountAmount?: number
  manualDiscountAmount?: number
  gstAmount?: number
  couponCode?: string | null
  paymentMode?: string
  isCredit?: boolean
  creditDueDate?: string | null
  /** Set once the credit sale has been settled — switches the credit banner from "payment due" to "paid/completed". */
  creditPaidAt?: string | null
  /** Savings scheme redeemed on this bill */
  schemeNumber?: string | null
  schemeDiscount?: number
  schemeAmountUsed?: number
  schemeBalanceAfter?: number | null
  advanceAmountUsed?: number
  exchangeAmount?: number
  customerGstin?: string | null
  customerPan?: string | null
  /** The bill's split_details: mixed payment amounts per method */
  splitDetails?: unknown
  schemeGramsUsed?: number | null
  schemeGoldRate?: number | null
  /** For a quotation: 'QUOTATION'. Default: TAX INVOICE / CREDIT INVOICE. */
  documentTitle?: string
}

/**
 * The bill as a PDF for download / WhatsApp: the same IGMOLS invoice sheet shown on screen
 * (the old drawn PDF layout is gone).
 */
export async function invoicePdfFile(data: InvoicePdfData): Promise<File> {
  const { documentTitle, items, ...rest } = data
  void documentTitle
  const props: InvoiceProps = {
    ...rest,
    invoiceNo: formatInvoiceNo(data.invoiceNo),
    items: items as unknown as InvoiceProps['items'],
    status: data.isCredit && !data.creditPaidAt ? 'Pending' : 'Completed',
  }
  return sheetPdfFile(createElement(Invoice, props), `Invoice-${formatInvoiceNo(data.invoiceNo)}`)
}

/** Captures the rendered invoice so the downloaded PDF matches the visible view. */
export async function invoicePdfFileFromElement(element: HTMLElement, invoiceNo: string): Promise<File> {
  return elementToPdfFile(element, `Invoice-${formatInvoiceNo(invoiceNo)}`)
}
