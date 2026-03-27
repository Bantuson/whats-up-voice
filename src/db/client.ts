// src/db/client.ts
// Singleton service_role Supabase client.
// NEVER pass request Authorization headers to this client.
// NEVER call supabase.auth.setSession().
// Every query MUST include .eq('user_id', userId) — service_role bypasses RLS.
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
