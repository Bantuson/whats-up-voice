-- =============================================================================
-- VoiceApp — 004_podcasts.sql
-- Persists generated podcast scripts so the user can replay them anytime.
-- Audio is re-synthesised on demand via /api/tts (no binary blob storage needed).
-- =============================================================================

CREATE TABLE IF NOT EXISTS generated_podcasts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  script     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE generated_podcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "generated_podcasts: service_role bypass"
  ON generated_podcasts FOR ALL TO service_role
  USING (true) WITH CHECK (true);
