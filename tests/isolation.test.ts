import { describe, test, expect } from 'bun:test'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

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
    test(`${tableName} returns zero rows for fabricated user_id`, async () => {
      const { data, error } = await supabase
        .from(tableName)
        .select('id')
        .eq('user_id', FABRICATED_USER_ID)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  }
})
