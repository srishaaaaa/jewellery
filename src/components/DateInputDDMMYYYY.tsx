import React, { useState, useEffect, useRef } from 'react'
import { AlertCircle, Calendar } from 'lucide-react'

export interface DateInputDDMMYYYYProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  required?: boolean
  disabled?: boolean
  label?: string
  showError?: boolean
}

export const DateInputDDMMYYYY: React.FC<DateInputDDMMYYYYProps> = ({
  value,
  onChange,
  placeholder = 'DD/MM/YYYY',
  className = '',
  required = false,
  disabled = false,
  label,
  showError = true,
}) => {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState('')
  const nativeInputRef = useRef<HTMLInputElement>(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!value) {
      setInputValue('')
      if (nativeInputRef.current) nativeInputRef.current.value = ''
    } else {
      try {
        const parts = value.split('-')
        const [year, month, day] = parts
        if (year && month && day) {
          setInputValue(`${day}/${month}/${year}`)
          if (nativeInputRef.current) nativeInputRef.current.value = value
        }
      } catch {
        setInputValue('')
        if (nativeInputRef.current) nativeInputRef.current.value = ''
      }
    }
  }, [value])
  /* eslint-enable react-hooks/set-state-in-effect */

  const validateAndConvert = (input: string): { iso: string; error: string } => {
    const cleaned = input.trim()
    if (!cleaned) return { iso: '', error: '' }

    const parts = cleaned.split('/')
    if (parts.length !== 3) {
      return { iso: '', error: 'Invalid format. Use: DD/MM/YYYY. Example: 09/25/2026' }
    }

    const [day, month, year] = parts.map(p => parseInt(p, 10))

    if (isNaN(day) || isNaN(month) || isNaN(year)) {
      return { iso: '', error: 'Invalid format. Use: DD/MM/YYYY. Example: 09/25/2026' }
    }

    if (day < 1 || day > 31) {
      return { iso: '', error: 'Day must be between 01 and 31' }
    }

    if (month < 1 || month > 12) {
      return { iso: '', error: 'Month must be between 01 and 12' }
    }

    if (year < 1900 || year > 2100) {
      return { iso: '', error: 'Year must be between 1900 and 2100' }
    }

    const date = new Date(year, month - 1, day)
    if (date.getDate() !== day || date.getMonth() !== month - 1) {
      return { iso: '', error: 'Invalid date (e.g., Feb 30)' }
    }

    const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    return { iso, error: '' }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    setInputValue(input)

    if (!input) {
      setError('')
      onChange('')
      return
    }

    const { iso, error: validationError } = validateAndConvert(input)
    setError(validationError)
    if (!validationError) {
      onChange(iso)
    }
  }

  const handleNativeDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateStr = e.target.value
    if (!dateStr) {
      setInputValue('')
      setError('')
      onChange('')
      return
    }

    const [year, month, day] = dateStr.split('-')
    const formattedInput = `${day}/${month}/${year}`
    setInputValue(formattedInput)

    const { iso, error: validationError } = validateAndConvert(formattedInput)
    setError(validationError)
    if (!validationError) {
      onChange(iso)
    }
  }

  const hasError = showError && error

  return (
    <div className="w-full">
      {label && <label className="block font-bold text-[#374151] mb-1 text-sm">{label}</label>}
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={inputValue}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={`w-full px-3 py-2 bg-white border rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-[#111111] placeholder:text-gray-400 pr-10 ${
            hasError ? 'border-red-500 focus:border-red-500' : 'border-gray-200'
          } ${className}`}
        />
        <input
          ref={nativeInputRef}
          type="date"
          onChange={handleNativeDateChange}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-8 cursor-pointer opacity-0"
          aria-hidden="true"
          style={{ pointerEvents: 'auto' }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {hasError ? <AlertCircle size={18} className="text-red-600" /> : <Calendar size={18} />}
        </div>
      </div>
      {hasError && (
        <p className="mt-1 text-[11px] text-red-600 font-bold flex items-center gap-1">
          {error}
        </p>
      )}
    </div>
  )
}
