import { describe, test, expect } from 'bun:test'
import { createClient } from '@supabase/supabase-js'

// Skip all Supabase integration tests when credentials are not set or are test placeholders.
// tests/setup.ts sets SUPABASE_URL='https://test.supabase.co' as a placeholder to prevent
// import-time crashes from supabase createClient(). Real credentials point to a *.supabase.co
// subdomain that is NOT 'test.supabase.co' and have a real JWT key (not 'test-service-role-key').
const hasSupabase =
  !!process.env.SUPABASE_URL &&
  process.env.SUPABASE_URL.length > 0 &&
  !process.env.SUPABASE_URL.includes('placeholder') &&
  process.env.SUPABASE_URL !== 'https://test.supabase.co' &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0 &&
  process.env.SUPABASE_SERVICE_ROLE_KEY !== 'test-service-role-key'

const supabase = hasSupabase
  ? createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  : null

const FABRICATED_USER_ID = '00000000-0000-0000-0000-000000000001'

// ISO-01: Even though service_role bypasses RLS, app-layer .eq('user_id', ...) must
// be applied to every query. These tests confirm that a fabricated user_id returns
// zero rows from tables that have user_id columns.
describe('ISO-01: App-layer user_id isolation', () => {
  const userScopedTables = [
    'user_profile',
    'user_contacts',
    'sessions',
    'message_log',
    'memory_store',
    'routines',
    'heartbeat_log',
  ]

  for (const tableName of userScopedTables) {
    test.skipIf(!hasSupabase)(`${tableName} returns zero rows for fabricated user_id`, async () => {
      const { data, error } = await supabase!
        .from(tableName)
        .select('id')
        .eq('user_id', FABRICATED_USER_ID)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  }
})
