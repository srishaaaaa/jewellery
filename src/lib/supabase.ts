import { createClient } from '@supabase/supabase-js'

// Vercel environment values can accidentally contain the next variable when
// several KEY=VALUE lines are pasted into one field. Keep the first non-empty
// line so a valid Supabase key still works, while preventing a newline from
// reaching the browser's Headers implementation.
const cleanEnvValue = (value: unknown) => {
  if (typeof value !== 'string') return ''
  const firstLine = value.split(/\r?\n/).map(line => line.trim()).find(Boolean) || ''
  return firstLine.replace(/^['"]|['"]$/g, '').trim()
}

const supabaseUrl = cleanEnvValue(
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined)
)

const supabaseAnonKey = cleanEnvValue(
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined)
)

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
)

export const isSupabaseConfigured =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  supabaseUrl !== 'https://placeholder.supabase.co' &&
  supabaseAnonKey !== 'placeholder-key'
