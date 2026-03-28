-- =============================================================================
-- VoiceApp — 003_caregiver_auth.sql
-- Adds caregiver identity tables and updates RLS on all VI-user tables.
-- Run AFTER 001_schema.sql and 002_functions.sql.
-- Apply via: Supabase SQL Editor (paste entire file) OR supabase db push
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: caregivers
-- Maps Supabase auth.uid() (caregiver) to display info.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caregivers (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE caregivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caregivers: caregiver can access own row"
  ON caregivers FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY "caregivers: service_role bypass"
  ON caregivers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- TABLE: caregiver_links
-- Many-to-one: one caregiver manages one VI user (design allows future M:1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caregiver_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (caregiver_id, user_id)
);
ALTER TABLE caregiver_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caregiver_links: caregiver can access own rows"
  ON caregiver_links FOR ALL
  USING (caregiver_id = auth.uid())
  WITH CHECK (caregiver_id = auth.uid());
CREATE POLICY "caregiver_links: service_role bypass"
  ON caregiver_links FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- UPDATE RLS on all VI-user tables: add caregiver access via caregiver_links
-- Existing auth.uid() user policies stay; we ADD caregiver policies alongside.
-- Tables: user_profile, user_contacts, sessions, message_log,
--         memory_store, routines, heartbeat_log
-- ---------------------------------------------------------------------------

CREATE POLICY "user_profile: caregiver can access linked user rows"
  ON user_profile FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = user_profile.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = user_profile.user_id
    )
  );

CREATE POLICY "user_contacts: caregiver can access linked user rows"
  ON user_contacts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = user_contacts.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = user_contacts.user_id
    )
  );

CREATE POLICY "sessions: caregiver can access linked user rows"
  ON sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = sessions.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = sessions.user_id
    )
  );

CREATE POLICY "message_log: caregiver can access linked user rows"
  ON message_log FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = message_log.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = message_log.user_id
    )
  );

CREATE POLICY "memory_store: caregiver can access linked user rows"
  ON memory_store FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = memory_store.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = memory_store.user_id
    )
  );

CREATE POLICY "routines: caregiver can access linked user rows"
  ON routines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = routines.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = routines.user_id
    )
  );

CREATE POLICY "heartbeat_log: caregiver can access linked user rows"
  ON heartbeat_log FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = heartbeat_log.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM caregiver_links
      WHERE caregiver_id = auth.uid()
      AND   user_id = heartbeat_log.user_id
    )
  );
