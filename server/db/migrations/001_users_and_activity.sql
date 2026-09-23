-- Phase 0: users, login sessions and the audit trail.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name          TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  -- App role: controls what the user can edit. Everyone can read everything.
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  -- Team the user belongs to at Luna (informational, used for ownership and filters).
  team          TEXT CHECK (team IN ('leadership', 'product_development', 'international', 'design', 'ecommerce', 'external')),
  password_hash TEXT,
  google_id     TEXT UNIQUE,
  active        BOOLEAN NOT NULL DEFAULT true,
  invited_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Session store for connect-pg-simple (schema matches its table.sql).
CREATE TABLE user_sessions (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_user_sessions_expire ON user_sessions (expire);

-- Audit trail: one row per change to any record.
CREATE TABLE activity_log (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  changes     JSONB NOT NULL DEFAULT '{}',
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_entity ON activity_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_activity_created ON activity_log (created_at DESC);
