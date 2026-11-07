import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Smartphone } from 'lucide-react'

import { upiReference, upiUri } from '../lib/upi'

/**
 * QR for paying the shop by UPI. A new reference is shown every `rotateMinutes`; an older QR still
 * pays the same shop account, so payments are matched by the UPI transaction details, not the QR.
 */
export function UpiQr({ upiId, name, amount, invoiceNo, rotateMinutes = 5, size = 240, showOpenButton = true }: {
  upiId: string; name: string; amount: number; invoiceNo: string; rotateMinutes?: number; size?: number; showOpenButton?: boolean
}) {
  const minutes = Math.min(60, Math.max(1, Math.round(rotateMinutes || 5)))
  const [now, setNow] = useState(() => Date.now())
  const [img, setImg] = useState('')
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const blockMs = minutes * 60000
  const block = Math.floor(now / blockMs)
  const ref = useMemo(() => upiReference(invoiceNo, minutes, block * blockMs), [invoiceNo, minutes, block, blockMs])
  const uri = useMemo(() => upiUri({ upiId, name, amount, note: `${invoiceNo.startsWith('DEP-') ? 'Order' : 'Invoice'} ${invoiceNo}`, ref }), [upiId, name, amount, invoiceNo, ref])
  useEffect(() => {
    let live = true
    QRCode.toDataURL(uri, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (live) setImg(url) })
      .catch(() => { if (live) setImg('') })
    return () => { live = false }
  }, [uri, size])
  const left = Math.max(0, (block + 1) * blockMs - now)
  const mm = String(Math.floor(left / 60000)).padStart(2, '0')
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')

  return (
    <div className="flex flex-col items-center text-center">
      <div className="rounded-2xl border border-black/10 bg-white p-3 shadow-sm">
        {img ? <img src={img} alt={`UPI QR to pay ${amount.toFixed(2)}`} width={size} height={size} /> : <div style={{ width: size, height: size }} className="animate-pulse rounded-xl bg-black/5" />}
      </div>
      <p className="mt-2 text-xs font-bold text-[#000000]">Pay {name} • {upiId}</p>
      <p className="text-[11px] font-semibold text-[#000000]/60">Ref {ref} · New QR in {mm}:{ss}</p>
      {showOpenButton && (
        <a href={uri} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-black">
          <Smartphone className="w-4 h-4" /> Open My UPI App
        </a>
      )}
    </div>
  )
}
