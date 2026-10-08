-- AOG Sandton City Church Youth — initial schema
-- Applied with: npx wrangler d1 migrations apply aogscc-youth-db --remote

-- People who submit the "Join Church" form
CREATE TABLE IF NOT EXISTS members (
  id                     TEXT PRIMARY KEY,
  ref_code               TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'new',       -- new | contacted | welcomed | member | inactive
  membership_type        TEXT NOT NULL,                      -- new_member | visitor | returning | transfer
  first_name             TEXT NOT NULL,
  last_name              TEXT NOT NULL,
  preferred_name         TEXT,
  date_of_birth          TEXT NOT NULL,                      -- ISO yyyy-mm-dd
  gender                 TEXT,
  phone                  TEXT NOT NULL,
  whatsapp_same          INTEGER NOT NULL DEFAULT 1,
  whatsapp               TEXT,
  email                  TEXT NOT NULL,
  suburb                 TEXT,
  city                   TEXT,
  address                TEXT,
  occupation_status      TEXT,                               -- school | university | working | seeking | other
  institution            TEXT,
  grade_or_role          TEXT,
  salvation_status       TEXT,                               -- saved | exploring | not_sure
  salvation_year         TEXT,
  water_baptised         TEXT,                               -- yes | no | want_to
  spirit_baptised        TEXT,                               -- yes | no | want_to
  previous_church        TEXT,
  heard_about            TEXT,
  invited_by             TEXT,
  interests              TEXT NOT NULL DEFAULT '[]',         -- JSON array of ministry slugs
  skills                 TEXT,
  availability           TEXT NOT NULL DEFAULT '[]',         -- JSON array
  emergency_name         TEXT,
  emergency_relationship TEXT,
  emergency_phone        TEXT,
  guardian_name          TEXT,
  guardian_phone         TEXT,
  guardian_email         TEXT,
  guardian_consent       INTEGER NOT NULL DEFAULT 0,
  care_notes             TEXT,                               -- anything leaders should know
  prayer_request         TEXT,
  comm_whatsapp          INTEGER NOT NULL DEFAULT 1,
  comm_email             INTEGER NOT NULL DEFAULT 1,
  comm_sms               INTEGER NOT NULL DEFAULT 0,
  photo_consent          INTEGER NOT NULL DEFAULT 0,
  popia_consent          INTEGER NOT NULL DEFAULT 0,
  signature_name         TEXT NOT NULL,
  admin_notes            TEXT,
  assigned_to            TEXT,
  ip_hash                TEXT,
  user_agent             TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_members_status     ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_created    ON members(created_at);
CREATE INDEX IF NOT EXISTS idx_members_email      ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_last_name  ON members(last_name);

-- Files attached to any submission (photos, transfer letters, etc.)
-- storage_driver lets us move from KV to R2 without a schema change.
CREATE TABLE IF NOT EXISTS attachments (
  id              TEXT PRIMARY KEY,
  owner_type      TEXT NOT NULL,                             -- member | prayer | contact | event
  owner_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,                             -- photo | document | image
  filename        TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  storage_driver  TEXT NOT NULL,                             -- kv | r2
  storage_key     TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS prayer_requests (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  email         TEXT,
  phone         TEXT,
  request       TEXT NOT NULL,
  is_anonymous  INTEGER NOT NULL DEFAULT 0,
  pastors_only  INTEGER NOT NULL DEFAULT 0,
  wants_contact INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'new',                 -- new | praying | answered | archived
  admin_notes   TEXT,
  ip_hash       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prayer_status ON prayer_requests(status, created_at);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  subject     TEXT,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',                   -- new | replied | archived
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'service',             -- service | night | camp | outreach | other
  description   TEXT,
  starts_at     TEXT NOT NULL,                               -- ISO datetime (SAST stored with offset)
  ends_at       TEXT,
  location      TEXT,
  is_published  INTEGER NOT NULL DEFAULT 1,
  rsvp_enabled  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(is_published, starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  guests      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rsvps_event ON event_rsvps(event_id);

-- Editable site content (service times, socials, address) without redeploying
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'leader',            -- admin | leader
  password_hash   TEXT NOT NULL,                             -- pbkdf2-sha256$iterations$salt_b64$hash_b64
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        TEXT PRIMARY KEY,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
