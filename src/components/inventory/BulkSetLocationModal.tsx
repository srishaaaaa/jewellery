import React, { useEffect, useState } from 'react'
import { X, MapPin, AlertCircle } from 'lucide-react'
import { getErrorMessage } from '../../lib/errorMessage'
import { ModalPortal } from '../ModalPortal'

export interface BulkSetLocationModalProps {
  isOpen: boolean
  onClose: () => void
  productCount: number
  onSubmit: (location: string) => Promise<void>
}

export const BulkSetLocationModal: React.FC<BulkSetLocationModalProps> = ({
  isOpen,
  onClose,
  productCount,
  onSubmit,
}) => {
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setLocation('')
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!location.trim()) {
      setError('Enter a storage location')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(location.trim())
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update storage location'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-hidden">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-md w-full border border-[#B7E1BE] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="shrink-0 bg-[#0A0A0A] px-5 py-3.5 border-b border-[var(--accent-a30)] flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1A1A1A] border border-[var(--accent)] flex items-center justify-center text-[var(--accent)]">
              <MapPin size={16} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black tracking-wide text-white leading-tight">
                Set Storage Location
              </h2>
              <p className="text-[11px] text-[var(--accent)] font-semibold leading-tight">
                Applies to {productCount} selected {productCount === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1.5">
              Storage Location
            </label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Rack 3, Row 2"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs font-black hover:bg-[#1A1A1A] transition-all disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Applying...' : `Apply to ${productCount} ${productCount === 1 ? 'item' : 'items'}`}
          </button>
        </form>
      </div>
    </div></ModalPortal>
  )
}
