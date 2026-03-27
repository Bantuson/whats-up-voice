-- =============================================================================
-- VoiceApp — 002_functions.sql
-- HNSW index on memory_store.embedding + SQL helper functions.
-- MUST be applied AFTER 001_schema.sql (depends on memory_store and user_contacts).
-- Apply via: Supabase SQL Editor (paste entire file) OR supabase db push
-- =============================================================================

-- HNSW index on memory_store.embedding
-- Must be created AFTER the table exists (001_schema.sql must run first).
CREATE INDEX IF NOT EXISTS memory_store_embedding_hnsw_idx
  ON memory_store
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- FUNCTION: match_memories
-- Cosine similarity search over a user's memory_store rows.
-- Called via supabase.rpc('match_memories', {...}) — PostgREST cannot use <=> directly.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count     INT,
  p_user_id       UUID
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM memory_store
  WHERE user_id = p_user_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 20);
$$;

-- FUNCTION: resolve_contact_name
-- Returns the user-assigned contact name for a phone number, or NULL if not saved.
CREATE OR REPLACE FUNCTION resolve_contact_name(
  p_user_id UUID,
  p_phone   TEXT
)
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT name
  FROM user_contacts
  WHERE user_id = p_user_id
    AND phone = p_phone
  LIMIT 1;
$$;
