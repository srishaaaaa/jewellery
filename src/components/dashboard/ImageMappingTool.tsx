/**
 * ImageMappingTool — Admin utility to map WhatsApp-exported images to products/variants,
 * then upload them to Supabase Storage and update image_url in the database.
 *
 * Workflow:
 *  1. Pick image from left gallery
 *  2. Select product (+ optional variant) on right
 *  3. Save mapping → stored in localStorage + exportable as image_mapping.json
 *  4. Review panel shows mapped/unmapped/duplicate stats
 *  5. "Upload & Apply" button triggers confirmation modal → uploads with progress
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Download, FileJson,
  Image as ImageIcon, RefreshCw, Search, Tag, Trash2, Upload, X, XCircle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errorMessage'
import { uploadProductImage } from '../../lib/storage'
import { useProductStore, useVariantStore } from '../../store/store'
import type { ProductVariant } from '../../services/variantService'
import { ModalPortal } from '../ModalPortal'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** key = productId  OR  "variant:{variantId}", value = image filename */
type Mappings = Record<string, string>

type UploadResult = {
  key: string
  file: string
  productName: string
  status: 'ok' | 'error'
  message?: string
  url?: string
}

const LS_KEY = 'mahalashmi-stores-image-mappings'
const IMAGES_BASE = '/assets/Images_V2/'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const imgUrl = (filename: string) =>
  IMAGES_BASE + filename.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20')

const loadFromStorage = (): Mappings => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') as Mappings
  } catch {
    return {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ImageMappingTool() {
  const { products, fetchProducts } = useProductStore()
  const { variantsMap, fetchVariants } = useVariantStore()

  // ── State ─────────────────────────────────────────────────────────────────
  const [images, setImages] = useState<string[]>([])
  const [mappings, setMappings] = useState<Mappings>(loadFromStorage)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [imageFilter, setImageFilter] = useState<'all' | 'mapped' | 'unmapped'>('all')
  const [view, setView] = useState<'map' | 'review'>('map')
  const [confirmUpload, setConfirmUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0, current: '' })
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load manifest + products/variants ─────────────────────────────────────
  useEffect(() => {
    fetch('/assets/Images_V2/manifest.json')
      .then(r => r.json())
      .then((data: { files: string[] }) => setImages(data.files))
      .catch(() => setImages([]))
  }, [])

  useEffect(() => {
    void fetchProducts()
    void fetchVariants()
  }, [fetchProducts, fetchVariants])

  // ── Persist mappings to localStorage whenever they change ─────────────────
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(mappings))
  }, [mappings])

  // ── Derived data ──────────────────────────────────────────────────────────
  const mappedFiles = useMemo(() => new Set(Object.values(mappings)), [mappings])

  const filteredImages = useMemo(() => {
    switch (imageFilter) {
      case 'mapped':   return images.filter(f => mappedFiles.has(f))
      case 'unmapped': return images.filter(f => !mappedFiles.has(f))
      default:         return images
    }
  }, [images, imageFilter, mappedFiles])

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase()
    if (!q) return products
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q),
    )
  }, [products, productSearch])

  const selectedProductVariants: ProductVariant[] = useMemo(
    () => (selectedProductId ? variantsMap[selectedProductId] || [] : []),
    [selectedProductId, variantsMap],
  )

  // Reverse map: filename → [key, productId]
  const fileToKey = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [k, f] of Object.entries(mappings)) m[f] = k
    return m
  }, [mappings])

  // Duplicate detection: files used more than once
  const duplicateFiles = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of Object.values(mappings)) counts[f] = (counts[f] || 0) + 1
    return new Set(Object.entries(counts).filter(([, c]) => c > 1).map(([f]) => f))
  }, [mappings])

  // Products with no mapping
  const unmappedProducts = useMemo(
    () => products.filter(p => !mappings[p.id] && !(variantsMap[p.id] || []).some(v => mappings[`variant:${v.id}`])),
    [products, mappings, variantsMap],
  )

  // ── Helpers ───────────────────────────────────────────────────────────────

  const labelForKey = useCallback((key: string) => {
    if (key.startsWith('variant:')) {
      const vid = key.slice(8)
      for (const variants of Object.values(variantsMap)) {
        const v = variants.find(x => x.id === vid)
        if (v) {
          const prod = products.find(p => String(p.id) === v.productId)
          return `${prod?.name || '?'} — ${v.variantName}`
        }
      }
      return `Variant ${vid}`
    }
    return products.find(p => String(p.id) === key)?.name || key
  }, [products, variantsMap])

  const showNotice = (type: 'ok' | 'err', msg: string) => {
    setNotice({ type, msg })
    setTimeout(() => setNotice(null), 3000)
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSelectImage = (filename: string) => {
    setSelectedImage(filename)
    // Pre-fill selects if image is already mapped
    const existingKey = fileToKey[filename]
    if (existingKey) {
      if (existingKey.startsWith('variant:')) {
        const vid = existingKey.slice(8)
        for (const [pid, variants] of Object.entries(variantsMap)) {
          if (variants.find(v => v.id === vid)) {
            setSelectedProductId(pid)
            setSelectedVariantId(vid)
            return
          }
        }
      } else {
        setSelectedProductId(existingKey)
        setSelectedVariantId('')
      }
    }
  }

  const handleSaveMapping = () => {
    if (!selectedImage || !selectedProductId) return
    const key = selectedVariantId ? `variant:${selectedVariantId}` : selectedProductId
    setMappings(prev => ({ ...prev, [key]: selectedImage }))
    showNotice('ok', `Mapped to ${labelForKey(key)}`)
    // Advance to next unmapped image
    const nextUnmapped = images.find(f => f !== selectedImage && !mappedFiles.has(f))
    if (nextUnmapped) {
      setSelectedImage(nextUnmapped)
      setSelectedProductId('')
      setSelectedVariantId('')
    }
  }

  const handleRemoveMapping = (key: string) => {
    setMappings(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleClearImageMapping = (filename: string) => {
    const key = fileToKey[filename]
    if (key) handleRemoveMapping(key)
    showNotice('ok', 'Mapping removed')
  }

  const handleClearAll = () => {
    if (!confirm('Clear all mappings? This cannot be undone.')) return
    setMappings({})
    showNotice('ok', 'All mappings cleared')
  }

  // Export image_mapping.json
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(mappings, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'image_mapping.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Import image_mapping.json
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as Mappings
        setMappings(data)
        showNotice('ok', `Imported ${Object.keys(data).length} mappings`)
      } catch {
        showNotice('err', 'Invalid JSON file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Upload & Apply ────────────────────────────────────────────────────────

  const handleUpload = async () => {
    setConfirmUpload(false)
    setUploading(true)
    setUploadResults([])

    const entries = Object.entries(mappings)
    setUploadProgress({ done: 0, total: entries.length, current: '' })

    const results: UploadResult[] = []

    for (let i = 0; i < entries.length; i++) {
      const [key, filename] = entries[i]
      const label = labelForKey(key)
      setUploadProgress({ done: i, total: entries.length, current: label })

      try {
        // Fetch the local static image as a Blob
        const response = await fetch(imgUrl(filename))
        if (!response.ok) throw new Error(`Cannot fetch image: ${response.status}`)
        const blob = await response.blob()
        const fileObj = new File([blob], filename, { type: blob.type || 'image/jpeg' })

        // Upload to Supabase Storage
        const publicUrl = await uploadProductImage(fileObj)

        // Update DB
        if (key.startsWith('variant:')) {
          const variantId = key.slice(8)
          const { error } = await supabase
            .from('product_variants')
            .update({ image_url: publicUrl })
            .eq('id', variantId)
          if (error) throw error
        } else {
          const { error } = await supabase
            .from('products')
            .update({ image_url: publicUrl })
            .eq('id', key)
          if (error) throw error
        }

        results.push({ key, file: filename, productName: label, status: 'ok', url: publicUrl })
      } catch (err) {
        results.push({
          key,
          file: filename,
          productName: label,
          status: 'error',
          message: getErrorMessage(err, String(err)),
        })
      }

      setUploadProgress({ done: i + 1, total: entries.length, current: label })
    }

    setUploadResults(results)
    setUploading(false)
    showNotice(
      results.some(r => r.status === 'error') ? 'err' : 'ok',
      `Done: ${results.filter(r => r.status === 'ok').length} uploaded, ${results.filter(r => r.status === 'error').length} errors`,
    )
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    totalImages:   images.length,
    totalProducts: products.length,
    mapped:        Object.keys(mappings).length,
    unmappedImages: images.filter(f => !mappedFiles.has(f)).length,
    duplicates:    duplicateFiles.size,
    productsMissingImages: unmappedProducts.length,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-[#111111]">Image Mapping</h2>
          <p className="text-[11px] text-[#374151] font-bold mt-0.5">
            Map product photos → Upload to Storage → Update database
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Import */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E5E7EB]/50 rounded-xl text-[12px] font-bold text-[#374151] hover:bg-[#F9FAFB] transition-colors"
          >
            <FileJson size={13} /> Import JSON
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />

          {/* Export */}
          <button
            type="button"
            onClick={handleExport}
            disabled={Object.keys(mappings).length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E5E7EB]/50 rounded-xl text-[12px] font-bold text-[#374151] hover:bg-[#F9FAFB] transition-colors disabled:opacity-40"
          >
            <Download size={13} /> Export JSON
          </button>

          {/* Clear all */}
          {Object.keys(mappings).length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-[12px] font-bold text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 size={13} /> Clear All
            </button>
          )}

          {/* Upload & Apply */}
          <button
            type="button"
            disabled={Object.keys(mappings).length === 0 || uploading}
            onClick={() => setConfirmUpload(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#111111] text-white rounded-xl text-[12px] font-black hover:bg-[#1e2817] transition-colors disabled:opacity-40"
          >
            <Upload size={13} />
            {uploading ? 'Uploading…' : 'Upload & Apply'}
          </button>
        </div>
      </div>

      {/* Toast notice */}
      {notice && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold ${
          notice.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {notice.type === 'ok' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {notice.msg}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Images', value: stats.totalImages, color: 'text-[#111111]' },
          { label: 'Total Products', value: stats.totalProducts, color: 'text-[#111111]' },
          { label: 'Mapped', value: stats.mapped, color: 'text-emerald-600' },
          { label: 'Unmapped Images', value: stats.unmappedImages, color: stats.unmappedImages > 0 ? 'text-amber-600' : 'text-emerald-600' },
          { label: 'Duplicates', value: stats.duplicates, color: stats.duplicates > 0 ? 'text-red-600' : 'text-emerald-600' },
          { label: 'Products Missing', value: stats.productsMissingImages, color: stats.productsMissingImages > 0 ? 'text-amber-600' : 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#E5E7EB]/30 px-2.5 sm:px-3 py-2.5 sm:py-3 shadow-sm">
            <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[#374151]">{s.label}</p>
            <p className={`text-[16px] sm:text-[22px] font-black leading-tight break-words ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* View tabs */}
      <div className="flex gap-1 bg-[#F9FAFB] p-1 rounded-xl w-fit">
        {(['map', 'review'] as const).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-lg text-[12px] font-black transition-colors ${
              view === v ? 'bg-white text-[#111111] shadow-sm' : 'text-[#374151]'
            }`}
          >
            {v === 'map' ? '🗺 Map Images' : '📋 Review & Validate'}
          </button>
        ))}
      </div>

      {/* ── MAP VIEW ── */}
      {view === 'map' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[600px]">
          {/* LEFT: Image gallery */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 shadow-sm flex flex-col">
            <div className="flex items-center justify-between gap-2 p-4 border-b border-[#E5E7EB]/20">
              <h3 className="text-[13px] font-black text-[#111111]">
                Images_V2 <span className="text-[#374151] font-bold">({filteredImages.length})</span>
              </h3>
              <div className="flex gap-1 bg-[#F9FAFB] p-0.5 rounded-lg">
                {(['all', 'unmapped', 'mapped'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setImageFilter(f)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors capitalize ${
                      imageFilter === f ? 'bg-white text-[#111111] shadow-sm' : 'text-[#374151]'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {filteredImages.map(filename => {
                  const isMapped = mappedFiles.has(filename)
                  const isDup = duplicateFiles.has(filename)
                  const isSelected = selectedImage === filename
                  const mappedTo = fileToKey[filename]

                  return (
                    <button
                      key={filename}
                      type="button"
                      onClick={() => handleSelectImage(filename)}
                      className={[
                        'relative flex flex-col overflow-hidden rounded-xl border-2 transition-all text-left',
                        isSelected
                          ? 'border-[#111111] shadow-md ring-2 ring-[#111111]/20'
                          : isDup
                          ? 'border-red-400'
                          : isMapped
                          ? 'border-emerald-400'
                          : 'border-[#E5E7EB]/40 hover:border-[var(--accent)]',
                      ].join(' ')}
                    >
                      {/* Image */}
                      <div className="aspect-square bg-[#F0F2EE] overflow-hidden">
                        <img
                          src={imgUrl(filename)}
                          alt={filename}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={e => {
                            const t = e.currentTarget
                            t.style.display = 'none'
                            if (t.parentElement) t.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-300"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>'
                          }}
                        />
                      </div>

                      {/* Status badge */}
                      <div className="p-1.5">
                        <p className="text-[9px] font-bold text-[#374151] leading-tight break-words" title={filename}>
                          {filename.replace('WhatsApp Image ', '').replace(' PM', '').replace(' AM', '')}
                        </p>
                        {isMapped && mappedTo && (
                          <p className="text-[8px] font-black text-emerald-600 break-words mt-0.5">
                            → {labelForKey(mappedTo)}
                          </p>
                        )}
                        {isDup && (
                          <p className="text-[8px] font-black text-red-500 mt-0.5">⚠ duplicate</p>
                        )}
                      </div>

                      {/* Corner check */}
                      {isMapped && !isDup && (
                        <div className="absolute right-1 top-1 h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center">
                          <Check size={10} className="text-white" strokeWidth={3} />
                        </div>
                      )}
                      {isDup && (
                        <div className="absolute right-1 top-1 h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                          <AlertTriangle size={9} className="text-white" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {filteredImages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ImageIcon size={36} className="text-gray-200 mb-2" />
                  <p className="text-[13px] font-bold text-[#9BAB9A]">No images in this filter</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Product selector */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 shadow-sm flex flex-col">
            {selectedImage ? (
              <>
                {/* Selected image preview */}
                <div className="p-4 border-b border-[#E5E7EB]/20">
                  <div className="flex items-start gap-3">
                    <div className="h-20 w-20 shrink-0 rounded-xl overflow-hidden bg-[#F0F2EE] border border-[#E5E7EB]/40">
                      <img
                        src={imgUrl(selectedImage)}
                        alt={selectedImage}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-black text-[#111111] leading-tight break-all">
                        {selectedImage}
                      </p>
                      {mappedFiles.has(selectedImage) ? (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            ✓ Mapped to {labelForKey(fileToKey[selectedImage])}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleClearImageMapping(selectedImage)}
                            className="text-[10px] font-bold text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full w-fit">
                          Unmapped
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Product search + select */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-[#374151] mb-1.5">
                      Search Product
                    </label>
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9BAB9A]" />
                      <input
                        type="text"
                        placeholder="Type product name…"
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2.5 bg-[#F9FAFB] rounded-xl text-[13px] font-bold border border-[#E5E7EB]/40 outline-none focus:border-[var(--accent)] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-[#374151] mb-1.5">
                      Select Product <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={selectedProductId}
                        onChange={e => {
                          setSelectedProductId(e.target.value)
                          setSelectedVariantId('')
                        }}
                        className="w-full appearance-none px-3 py-2.5 bg-[#F9FAFB] rounded-xl text-[13px] font-bold border border-[#E5E7EB]/40 outline-none focus:border-[var(--accent)] transition-colors pr-8"
                      >
                        <option value="">— Select product —</option>
                        {filteredProducts.map(p => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name} · {p.category}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9BAB9A] pointer-events-none" />
                    </div>
                  </div>

                  {/* Variant selector — only when product has variants */}
                  {selectedProductVariants.length > 0 && (
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-wider text-[#374151] mb-1.5">
                        Select Variant <span className="text-[#9BAB9A]">(optional — leave blank to map to product)</span>
                      </label>
                      <div className="relative">
                        <select
                          value={selectedVariantId}
                          onChange={e => setSelectedVariantId(e.target.value)}
                          className="w-full appearance-none px-3 py-2.5 bg-[#F9FAFB] rounded-xl text-[13px] font-bold border border-[#E5E7EB]/40 outline-none focus:border-[var(--accent)] transition-colors pr-8"
                        >
                          <option value="">— Map to product (all variants) —</option>
                          {selectedProductVariants.map(v => (
                            <option key={v.id} value={v.id}>
                              {v.variantName}{v.sizeLabel ? ` · ${v.sizeLabel}` : ''} — ₹{v.price}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9BAB9A] pointer-events-none" />
                      </div>
                    </div>
                  )}

                  {/* Product preview when selected */}
                  {selectedProductId && (() => {
                    const prod = products.find(p => String(p.id) === selectedProductId)
                    if (!prod) return null
                    return (
                      <div className="rounded-xl bg-[#F7F8F5] border border-[#E5E7EB]/40 p-3 flex items-center gap-3">
                        <Tag size={15} className="text-[var(--accent)] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-black text-[#111111] break-words">{prod.name}</p>
                          <p className="text-[11px] text-[#374151]">{prod.category} · ₹{prod.price}</p>
                          {prod.hasVariants && (
                            <p className="text-[10px] font-bold text-[var(--accent)]">
                              {selectedProductVariants.length} variant{selectedProductVariants.length !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Map button */}
                <div className="p-4 border-t border-[#E5E7EB]/20 flex gap-2">
                  <button
                    type="button"
                    disabled={!selectedProductId}
                    onClick={handleSaveMapping}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#111111] text-white text-[13px] font-black hover:bg-[#1e2817] disabled:opacity-40 transition-colors"
                  >
                    <Check size={15} strokeWidth={3} />
                    {mappedFiles.has(selectedImage) ? 'Update Mapping' : 'Save Mapping'}
                  </button>
                  {mappedFiles.has(selectedImage) && (
                    <button
                      type="button"
                      onClick={() => handleClearImageMapping(selectedImage)}
                      className="px-3 py-3 rounded-xl bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center px-8">
                <div className="h-16 w-16 rounded-2xl bg-[#F0F2EE] flex items-center justify-center mb-4">
                  <ImageIcon size={28} className="text-[#B2C7A5]" />
                </div>
                <h3 className="text-[14px] font-black text-[#111111] mb-1">Select an image</h3>
                <p className="text-[12px] text-[#9BAB9A] font-bold">
                  Click any image on the left to assign it to a product
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── REVIEW VIEW ── */}
      {view === 'review' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Mapped */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]/20">
              <h3 className="text-[13px] font-black text-[#111111]">
                ✓ Mapped ({Object.keys(mappings).length})
              </h3>
            </div>
            <div className="divide-y divide-[#E5E7EB]/20 max-h-[400px] overflow-y-auto">
              {Object.entries(mappings).length === 0 ? (
                <p className="p-6 text-center text-[12px] text-[#9BAB9A] font-bold">No mappings yet</p>
              ) : (
                Object.entries(mappings).map(([key, filename]) => (
                  <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-[#F0F2EE]">
                      <img src={imgUrl(filename)} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-[#111111] break-words">{labelForKey(key)}</p>
                      <p className="text-[10px] text-[#374151] break-words">{filename}</p>
                      {duplicateFiles.has(filename) && (
                        <p className="text-[10px] font-black text-red-500">⚠ duplicate image</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveMapping(key)}
                      className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Unmapped images + products missing */}
          <div className="space-y-4">
            {/* Unmapped images */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 shadow-sm">
              <div className="px-4 py-3 border-b border-[#E5E7EB]/20">
                <h3 className="text-[13px] font-black text-[#111111]">
                  ⚠ Unmapped Images ({images.filter(f => !mappedFiles.has(f)).length})
                </h3>
              </div>
              <div className="max-h-[200px] overflow-y-auto divide-y divide-[#E5E7EB]/20">
                {images.filter(f => !mappedFiles.has(f)).length === 0 ? (
                  <p className="p-4 text-center text-[12px] font-bold text-emerald-600">All images mapped ✓</p>
                ) : (
                  images.filter(f => !mappedFiles.has(f)).map(f => (
                    <div key={f} className="flex items-center gap-3 px-4 py-2">
                      <div className="h-8 w-8 shrink-0 rounded-lg overflow-hidden bg-[#F0F2EE]">
                        <img src={imgUrl(f)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <p className="text-[11px] text-[#374151] break-words flex-1">{f}</p>
                      <button
                        type="button"
                        onClick={() => { setSelectedImage(f); setView('map') }}
                        className="text-[10px] font-bold text-[var(--accent)] hover:underline shrink-0"
                      >
                        Map →
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Duplicate mappings */}
            {duplicateFiles.size > 0 && (
              <div className="bg-red-50 rounded-2xl border border-red-200 shadow-sm">
                <div className="px-4 py-3 border-b border-red-200">
                  <h3 className="text-[13px] font-black text-red-700">
                    ⚠ Duplicate Mappings ({duplicateFiles.size})
                  </h3>
                  <p className="text-[10px] text-red-600 mt-0.5">Same image mapped to multiple products</p>
                </div>
                <div className="max-h-[160px] overflow-y-auto px-4 py-2 space-y-1.5">
                  {[...duplicateFiles].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <AlertTriangle size={11} className="text-red-500 shrink-0" />
                      <p className="text-[11px] text-red-700 break-words">{f}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Products missing images */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 shadow-sm">
              <div className="px-4 py-3 border-b border-[#E5E7EB]/20">
                <h3 className="text-[13px] font-black text-[#111111]">
                  Products Missing Images ({unmappedProducts.length})
                </h3>
              </div>
              <div className="max-h-[200px] overflow-y-auto divide-y divide-[#E5E7EB]/20">
                {unmappedProducts.length === 0 ? (
                  <p className="p-4 text-center text-[12px] font-bold text-emerald-600">All products have images ✓</p>
                ) : (
                  unmappedProducts.slice(0, 40).map(p => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-[#111111] break-words">{p.name}</p>
                        <p className="text-[10px] text-[#374151]">{p.category}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProductId(String(p.id))
                          setView('map')
                        }}
                        className="text-[10px] font-bold text-[var(--accent)] hover:underline ml-3 shrink-0"
                      >
                        Map →
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UPLOAD PROGRESS ── */}
      {uploading && (
        <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw size={15} className="text-[var(--accent)] animate-spin" />
            <span className="text-[13px] font-black text-[#111111]">Uploading images…</span>
          </div>
          <div className="h-2 bg-[#F0F2EE] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-[11px] text-[#374151] font-bold">
            {uploadProgress.done} / {uploadProgress.total} — {uploadProgress.current}
          </p>
        </div>
      )}

      {/* ── UPLOAD RESULTS ── */}
      {uploadResults.length > 0 && !uploading && (
        <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 shadow-sm">
          <div className="px-4 py-3 border-b border-[#E5E7EB]/20 flex items-center justify-between">
            <h3 className="text-[13px] font-black text-[#111111]">Upload Results</h3>
            <div className="flex gap-3 text-[11px] font-black">
              <span className="text-emerald-600">✓ {uploadResults.filter(r => r.status === 'ok').length} success</span>
              {uploadResults.some(r => r.status === 'error') && (
                <span className="text-red-500">✗ {uploadResults.filter(r => r.status === 'error').length} failed</span>
              )}
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto divide-y divide-[#E5E7EB]/20">
            {uploadResults.map((r, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                {r.status === 'ok'
                  ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                }
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-[#111111] break-words">{r.productName}</p>
                  <p className="text-[10px] text-[#374151] break-words">{r.file}</p>
                  {r.status === 'error' && (
                    <p className="text-[10px] text-red-500 mt-0.5">{r.message}</p>
                  )}
                  {r.url && (
                    <p className="text-[10px] text-emerald-600 break-words">{r.url}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CONFIRM UPLOAD MODAL ── */}
      {confirmUpload && (
        <ModalPortal><div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmUpload(false)} />
          <div className="relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-500" />
              </div>
              <div>
                <h3 className="text-[15px] font-black text-[#111111]">Confirm Upload & Apply</h3>
                <p className="text-[12px] text-[#374151] mt-1">
                  This will upload <strong>{Object.keys(mappings).length} images</strong> to Supabase Storage
                  and update <strong>products.image_url</strong> in the database.
                </p>
              </div>
            </div>

            <div className="bg-[#F7F8F5] rounded-xl p-3 space-y-1 text-[11px] font-bold text-[#374151] max-h-[200px] overflow-y-auto">
              {Object.entries(mappings).map(([key, file]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className="text-[var(--accent)] shrink-0">→</span>
                  <span className="text-[#111111] break-words">{labelForKey(key)}</span>
                  <span className="shrink-0 opacity-60 break-words max-w-[120px]">{file}</span>
                </div>
              ))}
            </div>

            {duplicateFiles.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-xl border border-red-200">
                <AlertTriangle size={13} className="text-red-500 shrink-0" />
                <p className="text-[11px] font-bold text-red-700">
                  {duplicateFiles.size} duplicate image{duplicateFiles.size > 1 ? 's' : ''} — last mapping wins
                </p>
              </div>
            )}

            <p className="text-[11px] text-[#9BAB9A] font-bold">
              ⚠ This action cannot be automatically undone. Existing image URLs will be overwritten.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmUpload(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#E5E7EB]/60 text-[13px] font-black text-[#374151] hover:bg-[#F9FAFB] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleUpload()}
                className="flex-1 py-2.5 rounded-xl bg-[#111111] text-white text-[13px] font-black hover:bg-[#1e2817] transition-colors"
              >
                Upload & Apply
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
