-- Add pending_message column to user_profile for cross-restart confirmation persistence.
-- Stores the outbound message staged for user approval so a server restart mid-flow
-- doesn't lose the pending state and force the user to repeat themselves.
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS pending_message JSONB DEFAULT NULL;
