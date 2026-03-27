-- =============================================================================
-- VoiceApp — 001_schema.sql
-- All 8 tables with Row Level Security enabled.
-- Run this BEFORE 002_functions.sql.
-- Apply via: Supabase SQL Editor (paste entire file) OR supabase db push
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- TABLE: users
-- Identity anchor — WhatsApp phone number (E.164) maps to this row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users: user can access own row"
  ON users FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY "users: service_role bypass"
  ON users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: user_profile
-- Language preference, location, quiet hours, briefing flag.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profile (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language          TEXT NOT NULL DEFAULT 'en',
  location          TEXT,
  quiet_hours_start TIME,
  quiet_hours_end   TIME,
  briefing_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profile: user can access own row"
  ON user_profile FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_profile: service_role bypass"
  ON user_profile FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: user_contacts
-- Voice-populated contacts only — no device contact sync.
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
CREATE POLICY "user_contacts: user can access own rows"
  ON user_contacts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_contacts: service_role bypass"
  ON user_contacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: sessions
-- One active session per user — UNIQUE (user_id) enforced.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL DEFAULT 'idle',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  UNIQUE (user_id)
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions: user can access own row"
  ON sessions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "sessions: service_role bypass"
  ON sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

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
CREATE POLICY "message_log: user can access own rows"
  ON message_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "message_log: service_role bypass"
  ON message_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS message_log_user_created_idx
  ON message_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- TABLE: memory_store
-- Episodic memory with pgvector embeddings (OpenAI text-embedding-3-small).
-- HNSW index created in 002_functions.sql (must run after this table exists).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE memory_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memory_store: user can access own rows"
  ON memory_store FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "memory_store: service_role bypass"
  ON memory_store FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: routines
-- User-defined scheduled tasks (morning briefing, evening digest, reminders).
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
CREATE POLICY "routines: user can access own rows"
  ON routines FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "routines: service_role bypass"
  ON routines FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: heartbeat_log
-- Records every heartbeat engine decision for audit and debugging.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  UUID REFERENCES message_log(id),
  decision    TEXT NOT NULL CHECK (decision IN ('interrupt', 'batch', 'silent', 'skip')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE heartbeat_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "heartbeat_log: user can access own rows"
  ON heartbeat_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "heartbeat_log: service_role bypass"
  ON heartbeat_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS heartbeat_log_user_created_idx
  ON heartbeat_log (user_id, created_at DESC);
