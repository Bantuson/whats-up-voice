// frontend/src/lib/supabase.ts
// Supabase JS client singleton.
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from Vite env.
// persistSession: true (default) — localStorage-backed session rehydration.
// Import this singleton wherever Supabase auth or DB queries are needed.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // automatic localStorage persistence (default)
    autoRefreshToken: true,     // refresh JWT before expiry (default)
    detectSessionInUrl: true,   // handle magic-link redirects (default)
  },
})
