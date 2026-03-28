// src/memory/recall.ts
// MEM-02: Recall relevant memories for a given query using cosine similarity.
// Uses match_memories SQL function deployed in Phase 1 (002_functions.sql).
import { generateEmbedding } from './embed'
import { supabase } from '../db/client'

export interface MemoryRow {
  id: string
  content: string
  similarity: number
}

export async function recallMemories(
  userId: string,
  query: string,
  topK = 5,
): Promise<MemoryRow[]> {
  const embedding = await generateEmbedding(query)
  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: embedding,
    match_threshold: 0.75,
    match_count: topK,
    p_user_id: userId,
  })
  if (error) throw new Error(`recallMemories failed: ${error.message}`)
  return data ?? []
}
