/**
 * authService.ts
 * Wraps Supabase Auth with a development-only localStorage fallback.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase'

export interface AuthUser {
  id: string
  name: string
  mobile: string
  email: string
  role: 'admin' | 'customer'
}

const USE_LOCAL_AUTH_FALLBACK = import.meta.env.DEV && !isSupabaseConfigured

type LocalUser = {
  id: string
  name: string
  mobile: string
  email: string
  password: string
  role: 'admin' | 'customer'
  created_at: string
  orders: unknown[]
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return null
}

const normalizeLocalUser = (value: unknown): LocalUser | null => {
  const record = asRecord(value)
  if (!record) return null

  const id = typeof record.id === 'string' ? record.id : ''
  const email = typeof record.email === 'string' ? record.email : ''
  if (!id || !email) return null

  return {
    id,
    name: typeof record.name === 'string' ? record.name : 'Customer',
    mobile: typeof record.mobile === 'string' ? record.mobile : '',
    email,
    password: typeof record.password === 'string' ? record.password : '',
    role: record.role === 'admin' ? 'admin' : 'customer',
    created_at: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    orders: Array.isArray(record.orders) ? record.orders : [],
  }
}

// Helper for localStorage fallback
const getUsers = (): LocalUser[] => {
  try {
    const raw = localStorage.getItem('mahalashmi_stores_users') || '[]'
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => normalizeLocalUser(entry))
      .filter((entry): entry is LocalUser => entry !== null)
  } catch {
    return []
  }
}

const saveUsers = (u: LocalUser[]) => localStorage.setItem('mahalashmi_stores_users', JSON.stringify(u))

const getProductionAuthError = () => ({ user: null, error: 'Supabase is required for authentication in production' })

// ── auth exposed API ─────────────────────────────────────────
export const authService = {

  signUp: async (params: {
    email: string
    password: string
    name: string
    mobile: string
  }): Promise<{ user: AuthUser | null; error: string | null }> => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({
        email: params.email,
        password: params.password,
        options: {
          data: { name: params.name, mobile: params.mobile },
          emailRedirectTo: `${window.location.origin}/`,
        },
      })
      if (error) return { user: null, error: error.message }
      if (!data.user) return { user: null, error: 'Signup failed, please try again' }

      // Fetch profile (trigger creates it)
      await new Promise(r => setTimeout(r, 500))
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()

      return {
        user: {
          id: data.user.id,
          name: profile?.name || data.user.user_metadata?.name || params.name,
          mobile: profile?.mobile || data.user.user_metadata?.mobile || params.mobile,
          email: data.user.email || params.email,
          role: profile?.role === 'admin' ? 'admin' : 'customer',
        },
        error: null,
      }
    }

    if (!USE_LOCAL_AUTH_FALLBACK) {
      return getProductionAuthError()
    }

    // localStorage fallback
    const users = getUsers()
    if (users.find((u) => u.email === params.email)) {
      return { user: null, error: 'Email already registered' }
    }
    const newUser: LocalUser = {
      id: Date.now().toString(),
      name: params.name,
      mobile: params.mobile,
      email: params.email,
      password: params.password,
      role: 'customer',
      created_at: new Date().toISOString(),
      orders: [],
    }
    saveUsers([...users, newUser])
    localStorage.setItem('mahalashmi_stores_session', newUser.id)
    return { user: { id: newUser.id, name: newUser.name, mobile: newUser.mobile, email: newUser.email, role: 'customer' }, error: null }
  },

  signIn: async (email: string, password: string): Promise<{ user: AuthUser | null; error: string | null }> => {
    // Allow login with mobile number (convert to email)
    const loginEmail = email.includes('@') ? email : email  // pass through, handled below

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })
      if (error) return { user: null, error: 'Invalid email or password' }
      if (!data.user) return { user: null, error: 'Login failed' }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()

      return {
        user: {
          id: data.user.id,
          name: profile?.name || data.user.user_metadata?.name || data.user.email || '',
          mobile: profile?.mobile || data.user.user_metadata?.mobile || '',
          email: data.user.email || '',
          role: profile?.role === 'admin' ? 'admin' : 'customer',
        },
        error: null,
      }
    }

    if (!USE_LOCAL_AUTH_FALLBACK) {
      return { user: null, error: 'Supabase is required for authentication in production' }
    }

    // localStorage fallback — support email or mobile login
    const users = getUsers()
    const match = users.find((u) =>
      (u.email === loginEmail || u.mobile === loginEmail) && u.password === password
    )
    if (!match) return { user: null, error: 'Invalid credentials' }
    localStorage.setItem('mahalashmi_stores_session', match.id)
    return { user: { id: match.id, name: match.name, mobile: match.mobile, email: match.email, role: match.role }, error: null }
  },

  signOut: async (): Promise<void> => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    if (USE_LOCAL_AUTH_FALLBACK) {
      localStorage.removeItem('mahalashmi_stores_session')
    }
  },

  getCurrentUser: async (): Promise<AuthUser | null> => {
    if (isSupabaseConfigured) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      return {
        id: user.id,
        name: profile?.name || user.user_metadata?.name || user.email || '',
        mobile: profile?.mobile || user.user_metadata?.mobile || '',
        email: user.email || '',
        role: profile?.role === 'admin' ? 'admin' : 'customer',
      }
    }

    if (!USE_LOCAL_AUTH_FALLBACK) {
      return null
    }

    // localStorage fallback
    const sid = localStorage.getItem('mahalashmi_stores_session')
    if (!sid) return null
    const users = getUsers()
    const u = users.find((x) => x.id === sid)
    if (!u) return null
    return { id: u.id, name: u.name, mobile: u.mobile, email: u.email, role: u.role }
  },

  updateProfile: async (updates: { name?: string; mobile?: string }): Promise<{ error: string | null }> => {
    if (isSupabaseConfigured) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { error: 'Not authenticated' }
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
      return { error: error?.message || null }
    }
    if (!USE_LOCAL_AUTH_FALLBACK) {
      return { error: 'Supabase is required for profile updates in production' }
    }

    const sid = localStorage.getItem('mahalashmi_stores_session')
    if (sid) {
      const users = getUsers()
      const updated = users.map((u) => (u.id === sid ? { ...u, ...updates } : u))
      saveUsers(updated)
    }
    return { error: null }
  },

  onAuthStateChange: (callback: (user: AuthUser | null) => void) => {
    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
          callback({
            id: session.user.id,
            name: profile?.name || session.user.user_metadata?.name || session.user.email || '',
            mobile: profile?.mobile || session.user.user_metadata?.mobile || '',
            email: session.user.email || '',
            role: profile?.role === 'admin' ? 'admin' : 'customer',
          })
        } else {
          callback(null)
        }
      })
      return () => subscription.unsubscribe()
    }
    if (!USE_LOCAL_AUTH_FALLBACK) {
      callback(null)
      return () => {}
    }

    // No-op for localStorage mode
    return () => {}
  },

  verifyOtp: async (email: string, token: string): Promise<{ error: string | null }> => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',   // 'signup' was wrong — correct type for email OTP/magic-link is 'email'
      })
      if (error) return { error: error.message }
      if (!data.session) return { error: 'Verification failed' }
      return { error: null }
    }
    if (!USE_LOCAL_AUTH_FALLBACK) {
      return { error: 'Supabase is required for verification in production' }
    }

    // localStorage mode simulation
    if (token === '123456') return { error: null }
    return { error: 'Invalid OTP' }
  },
}
