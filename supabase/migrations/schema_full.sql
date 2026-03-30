-- =============================================================================
-- VoiceApp — Full Schema (single-file migration)
-- Combines all incremental migrations into one idempotent script.
-- Run this ONCE in the Supabase SQL Editor to set up a fresh project.
-- Settings → SQL Editor → New query → paste → Run
-- =============================================================================

-- pgvector extension (enabled by default on Supabase — safe to re-run)
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- TABLE: users
-- Identity anchor — WhatsApp phone number (E.164) maps to this row.
-- The backend creates this row on first inbound WhatsApp message.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users: user can access own row"
  ON users FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY IF NOT EXISTS "users: service_role bypass"
  ON users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: user_profile
-- Language, location, quiet hours, briefing flag, pending message state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profile (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language          TEXT NOT NULL DEFAULT 'en',
  location          TEXT,
  quiet_hours_start TIME,
  quiet_hours_end   TIME,
  briefing_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  -- Persists outbound message awaiting user voice confirmation across server restarts
  pending_message   JSONB DEFAULT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "user_profile: user can access own row"
  ON user_profile FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "user_profile: service_role bypass"
  ON user_profile FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: user_contacts
-- Voice-populated contacts — no device sync.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_priority BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone)
);
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "user_contacts: user can access own rows"
  ON user_contacts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "user_contacts: service_role bypass"
  ON user_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: sessions
-- One active session per user — tracks the current voice interaction phase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase      TEXT NOT NULL DEFAULT 'idle',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at   TIMESTAMPTZ,
  UNIQUE (user_id)
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "sessions: user can access own row"
  ON sessions FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "sessions: service_role bypass"
  ON sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: message_log
-- All inbound and outbound WhatsApp messages.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  from_phone    TEXT NOT NULL,
  to_phone      TEXT NOT NULL,
  body          TEXT,
  media_type    TEXT,
  media_id      TEXT,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "message_log: user can access own rows"
  ON message_log FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "message_log: service_role bypass"
  ON message_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS message_log_user_created_idx
  ON message_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- TABLE: memory_store
-- Episodic memory with pgvector embeddings (OpenAI text-embedding-3-small).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_store (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  embedding  VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE memory_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "memory_store: user can access own rows"
  ON memory_store FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "memory_store: service_role bypass"
  ON memory_store FOR ALL TO service_role USING (true) WITH CHECK (true);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS memory_store_embedding_hnsw_idx
  ON memory_store USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- TABLE: routines
-- User-defined scheduled tasks (morning briefing, reminders).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_type    TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  label           TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "routines: user can access own rows"
  ON routines FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "routines: service_role bypass"
  ON routines FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: heartbeat_log
-- Records every heartbeat engine decision for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES message_log(id),
  decision   TEXT NOT NULL CHECK (decision IN ('interrupt', 'batch', 'silent', 'skip')),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE heartbeat_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "heartbeat_log: user can access own rows"
  ON heartbeat_log FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY IF NOT EXISTS "heartbeat_log: service_role bypass"
  ON heartbeat_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS heartbeat_log_user_created_idx
  ON heartbeat_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- TABLE: generated_podcasts
-- Persists podcast scripts for replay. Audio is re-synthesised on demand.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_podcasts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  script     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE generated_podcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "generated_podcasts: service_role bypass"
  ON generated_podcasts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: caregivers
-- Supabase Auth user who monitors the VI user via the dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caregivers (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE caregivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "caregivers: caregiver can access own row"
  ON caregivers FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY IF NOT EXISTS "caregivers: service_role bypass"
  ON caregivers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: caregiver_links
-- Links a caregiver Supabase auth user to a VI user record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caregiver_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (caregiver_id, user_id)
);
ALTER TABLE caregiver_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "caregiver_links: caregiver can access own rows"
  ON caregiver_links FOR ALL USING (caregiver_id = auth.uid()) WITH CHECK (caregiver_id = auth.uid());
CREATE POLICY IF NOT EXISTS "caregiver_links: service_role bypass"
  ON caregiver_links FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- RLS: Caregiver access to VI-user tables via caregiver_links
-- ---------------------------------------------------------------------------
CREATE POLICY IF NOT EXISTS "user_profile: caregiver can access linked user rows"
  ON user_profile FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = user_profile.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = user_profile.user_id));

CREATE POLICY IF NOT EXISTS "user_contacts: caregiver can access linked user rows"
  ON user_contacts FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = user_contacts.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = user_contacts.user_id));

CREATE POLICY IF NOT EXISTS "sessions: caregiver can access linked user rows"
  ON sessions FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = sessions.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = sessions.user_id));

CREATE POLICY IF NOT EXISTS "message_log: caregiver can access linked user rows"
  ON message_log FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = message_log.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = message_log.user_id));

CREATE POLICY IF NOT EXISTS "memory_store: caregiver can access linked user rows"
  ON memory_store FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = memory_store.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = memory_store.user_id));

CREATE POLICY IF NOT EXISTS "routines: caregiver can access linked user rows"
  ON routines FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = routines.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = routines.user_id));

CREATE POLICY IF NOT EXISTS "heartbeat_log: caregiver can access linked user rows"
  ON heartbeat_log FOR ALL
  USING (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = heartbeat_log.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM caregiver_links WHERE caregiver_id = auth.uid() AND user_id = heartbeat_log.user_id));

-- ---------------------------------------------------------------------------
-- FUNCTION: match_memories
-- Cosine similarity search over a user's memory_store rows.
-- Called via supabase.rpc('match_memories', {...})
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count     INT,
  p_user_id       UUID
)
RETURNS TABLE (id UUID, content TEXT, similarity FLOAT)
LANGUAGE SQL STABLE AS $$
  SELECT id, content, 1 - (embedding <=> query_embedding) AS similarity
  FROM memory_store
  WHERE user_id = p_user_id
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding ASC
  LIMIT LEAST(match_count, 20);
$$;

-- ---------------------------------------------------------------------------
-- FUNCTION: resolve_contact_name
-- Returns the saved contact name for a phone number, or NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_contact_name(p_user_id UUID, p_phone TEXT)
RETURNS TEXT
LANGUAGE SQL STABLE AS $$
  SELECT name FROM user_contacts
  WHERE user_id = p_user_id AND phone = p_phone
  LIMIT 1;
$$;
