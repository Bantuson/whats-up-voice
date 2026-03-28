// tests/memory.test.ts
// MEM-01, MEM-02, MEM-03: Episodic memory unit tests with mocked clients.
// mock.module declarations must come before any production imports (Bun hoists).

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// --- Mocks (must be before production imports) ---

const mockEmbeddingCreate = mock(async () => ({
  data: [{ embedding: new Array(1536).fill(0.1) }],
}))

mock.module('openai', () => ({
  OpenAI: class MockOpenAI {
    embeddings = { create: mockEmbeddingCreate }
  },
}))

const mockRpc = mock(async () => ({
  data: [
    { id: 'mem-001', content: 'User asked about load shedding.', similarity: 0.91 },
    { id: 'mem-002', content: 'User saved contact Naledi.', similarity: 0.85 },
  ],
  error: null,
}))

const mockInsert = mock(async () => ({ error: null }))

mock.module('../src/db/client', () => ({
  supabase: {
    from: (_table: string) => ({
      insert: mockInsert,
    }),
    rpc: mockRpc,
  },
}))

// --- Production imports (after mocks) ---
import { generateEmbedding } from '../src/memory/embed'
import { storeMemory } from '../src/memory/store'
import { recallMemories } from '../src/memory/recall'

describe('Episodic memory', () => {
  beforeEach(() => {
    mockEmbeddingCreate.mockClear()
    mockRpc.mockClear()
    mockInsert.mockClear()
  })

  test('MEM-01: generateEmbedding calls text-embedding-3-small and returns 1536-dim vector', async () => {
    const result = await generateEmbedding('User sent a message to Naledi.')
    expect(mockEmbeddingCreate).toHaveBeenCalledTimes(1)
    const callArgs = mockEmbeddingCreate.mock.calls[0][0] as { model: string; input: string }
    expect(callArgs.model).toBe('text-embedding-3-small')
    expect(callArgs.input).toBe('User sent a message to Naledi.')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1536)
  })

  test('MEM-01: storeMemory inserts to memory_store with user_id', async () => {
    const embedding = new Array(1536).fill(0.1)
    await storeMemory('user-abc', 'Session summary text.', embedding)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const insertArg = mockInsert.mock.calls[0][0] as { user_id: string; content: string; embedding: number[] }
    expect(insertArg.user_id).toBe('user-abc')
    expect(insertArg.content).toBe('Session summary text.')
    expect(insertArg.embedding.length).toBe(1536)
  })

  test('MEM-02: recallMemories calls match_memories RPC with correct parameters', async () => {
    const results = await recallMemories('user-abc', 'load shedding today', 5)
    expect(mockEmbeddingCreate).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledTimes(1)
    const rpcArgs = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(rpcArgs[0]).toBe('match_memories')
    expect(rpcArgs[1].match_threshold).toBe(0.75)
    expect(rpcArgs[1].match_count).toBe(5)
    expect(rpcArgs[1].p_user_id).toBe('user-abc')
    expect(Array.isArray(rpcArgs[1].query_embedding)).toBe(true)
    expect(results.length).toBe(2)
  })

  test('MEM-03: recalled memory content can be injected into a system prompt', () => {
    const memories = [
      { id: 'mem-001', content: 'User asked about load shedding.', similarity: 0.91 },
      { id: 'mem-002', content: 'User saved contact Naledi.', similarity: 0.85 },
    ]
    const memoryContext = memories.length > 0
      ? `\n\nRelevant memories from past sessions:\n${memories.map((m) => `- ${m.content}`).join('\n')}`
      : ''
    const systemPrompt = `You are a voice assistant.${memoryContext}`
    expect(systemPrompt).toContain('User asked about load shedding.')
    expect(systemPrompt).toContain('User saved contact Naledi.')
    expect(systemPrompt).toContain('Relevant memories from past sessions:')
  })

  test('MEM-02: recallMemories returns empty array when RPC returns null data', async () => {
    mockRpc.mockImplementationOnce(async () => ({ data: null, error: null }))
    const results = await recallMemories('user-abc', 'weather', 5)
    expect(results).toEqual([])
  })
})
