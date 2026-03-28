// src/memory/store.ts
// MEM-01: Persist session memory with embedding to memory_store table.
// CRITICAL: service_role bypasses RLS — user_id column enforces app-layer isolation.
import { supabase } from '../db/client'

export async function storeMemory(
  userId: string,
  summary: string,
  embedding: number[],
): Promise<void> {
  const { error } = await supabase
    .from('memory_store')
    .insert({ user_id: userId, content: summary, embedding })
  if (error) throw new Error(`storeMemory failed: ${error.message}`)
}
