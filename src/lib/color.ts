/** Darkens a hex colour by a fraction (0-1). Used to derive a hover/dark accent shade from a single user-picked accent colour. */
export function darkenHex(hex: string, amount = 0.22): string {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex
  const num = parseInt(clean, 16)
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)))
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - amount)))
  const b = Math.max(0, Math.round((num & 0xff) * (1 - amount)))
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Tailwind's opacity-modifier syntax (e.g. `bg-[var(--accent)]/20`) can't resolve
 * an alpha value against a CSS variable holding a hex string, so it silently drops
 * the opacity. Precomputed rgba() variables (one per opacity level actually used
 * in the app, applied directly with no slash, e.g. `bg-[var(--accent-a20)]`)
 * sidestep that — see ACCENT_ALPHA_STEPS below.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(46, 125, 50, ${alpha})`
  const num = parseInt(clean, 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Opacity levels (%) used across the app for accent-tinted backgrounds/borders/rings. */
export const ACCENT_ALPHA_STEPS = [5, 10, 15, 20, 30, 40, 50] as const
