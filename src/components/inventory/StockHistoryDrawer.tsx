import React, { useEffect, useState } from 'react'
import { X, History, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react'
import { inventoryService, type InventoryMovement, type InventoryStockItem } from '../../services/inventoryService'
import { BRAND_EN } from '../../lib/brand'
import { ModalPortal } from '../ModalPortal'

export interface StockHistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  item: InventoryStockItem | null
}

export const StockHistoryDrawer: React.FC<StockHistoryDrawerProps> = ({
  isOpen,
  onClose,
  item,
}) => {
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !item) return

    let isMounted = true

    const loadHistory = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await inventoryService.fetchMovements({
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          limit: 50,
        })
        if (isMounted) setMovements(res.movements)
      } catch (err) {
        if (isMounted) setError((err as Error).message || 'Failed to load stock movements')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void loadHistory()

    return () => {
      isMounted = false
    }
  }, [isOpen, item])

  if (!isOpen || !item) return null

  const getBadgeStyle = (type: string) => {
    switch (type) {
      case 'INITIAL_BARCODE_STOCK':
      case 'RESTOCK':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300'
      case 'SALE':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'DAMAGE':
        return 'bg-rose-100 text-rose-800 border-rose-300'
      case 'RETURN':
        return 'bg-purple-100 text-purple-800 border-purple-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 border-l border-[#B7E1BE] safe-area-inset-right">
        {/* Header */}
        <div className="bg-[#0A0A0A] px-5 py-4 border-b border-[var(--accent-a30)] flex items-center justify-between text-white sticky top-0 z-10 safe-area-inset-top min-h-16">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-[#1A1A1A] border border-[var(--accent)] flex items-center justify-center text-[var(--accent)] shrink-0">
              <History size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black tracking-wide text-white truncate">
                Stock Audit Ledger
              </h2>
              <p className="text-xs text-[var(--accent)] font-semibold">
                {BRAND_EN} Immutable History
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0 ml-2"
          >
            <X size={20} />
          </button>
        </div>

        {/* Item Summary Bar */}
        <div className="bg-[#FBFAF6] border-b border-[#B7E1BE] p-4 sticky top-16 z-10">
          <div className="text-[11px] font-black uppercase tracking-wider text-[var(--accent-dark)] mb-1">
            📦 Target SKU
          </div>
          <div className="text-base font-black text-black break-words">{item.name}</div>
          {item.variant_name && (
            <div className="mt-1 inline-block text-xs font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
              Variant: {item.variant_name}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-xs font-semibold text-gray-700">
            <span>Live Stock: <strong className="text-black text-sm">{item.stock} Units</strong></span>
            {item.barcode && <span>Barcode: <strong className="font-mono text-black">{item.barcode}</strong></span>}
          </div>
        </div>

        {/* Timeline Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-gray-500 text-sm flex flex-col items-center gap-2">
              <RefreshCw size={20} className="animate-spin text-[#0A0A0A]" />
              Loading audit movements...
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
              {error}
            </div>
          ) : movements.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              No stock movements recorded yet for this SKU.
            </div>
          ) : (
            movements.map((m) => {
              const isPositive = m.quantity_delta > 0
              const formattedDate = new Date(m.created_at).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })

              return (
                <div
                  key={m.id}
                  className="bg-[#FBFAF6] border border-gray-200 hover:border-[#B7E1BE] rounded-2xl p-3.5 space-y-2 transition-all shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${getBadgeStyle(
                        m.movement_type
                      )}`}
                    >
                      {m.movement_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] text-gray-500 font-medium">
                      {formattedDate}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5">
                      {isPositive ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                          <ArrowUpRight size={14} />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center">
                          <ArrowDownRight size={14} />
                        </div>
                      )}
                      <span
                        className={`text-base font-black ${
                          isPositive ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {isPositive ? `+${m.quantity_delta}` : m.quantity_delta}
                      </span>
                    </div>

                    <div className="text-right text-xs font-semibold text-gray-600">
                      <span>{m.quantity_before}</span> &rarr;{' '}
                      <strong className="text-black font-black">{m.quantity_after}</strong>
                    </div>
                  </div>

                  {(m.reference_id || m.note || m.created_by_name) && (
                    <div className="text-[11px] text-gray-600 bg-white p-2 rounded-xl border border-gray-100 space-y-0.5">
                      {m.reference_id && (
                        <div>
                          <span className="text-gray-400">Ref:</span> #{m.reference_id}
                        </div>
                      )}
                      {m.note && <div>{m.note}</div>}
                      {m.created_by_name && (
                        <div className="text-[10px] text-gray-400">
                          By: {m.created_by_name}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div></ModalPortal>
  )
}
