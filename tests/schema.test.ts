import { describe, test, expect } from 'bun:test'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const REQUIRED_TABLES = [
  'users',
  'user_profile',
  'user_contacts',
  'sessions',
  'message_log',
  'memory_store',
  'routines',
  'heartbeat_log',
]

describe('INFRA-01: All 8 tables exist', () => {
  for (const tableName of REQUIRED_TABLES) {
    test(`table "${tableName}" exists and is queryable`, async () => {
      // select count — service_role can read all rows (bypass policy)
      const { error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
      expect(error).toBeNull()
    })
  }
})

describe('INFRA-03: SQL functions are deployed', () => {
  test('match_memories RPC executes without error', async () => {
    // Call with a zero-vector and threshold 0.99 — expects empty result, not an error
    const fakeEmbedding = new Array(1536).fill(0)
    const fakeUserId = '00000000-0000-0000-0000-000000000000'
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: fakeEmbedding,
      match_threshold: 0.99,
      match_count: 5,
      p_user_id: fakeUserId,
    })
    // No error — empty array is correct (no memories for fake user)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('resolve_contact_name RPC executes without error', async () => {
    const fakeUserId = '00000000-0000-0000-0000-000000000000'
    const { data, error } = await supabase.rpc('resolve_contact_name', {
      p_user_id: fakeUserId,
      p_phone: '+27000000000',
    })
    // Returns NULL for unknown user/phone — that is correct
    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})
