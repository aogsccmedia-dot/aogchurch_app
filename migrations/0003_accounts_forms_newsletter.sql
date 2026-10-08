-- v2: Google accounts, single-admin email-code login, Tally-style event forms,
-- weekly announcement letter (subscribers, announcements, deliveries).

-- Password-based leader accounts are replaced by Google sign-in + emailed admin codes.
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS event_rsvps;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  google_sub     TEXT UNIQUE,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT,
  given_name     TEXT,
  family_name    TEXT,
  picture        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                          -- user | admin
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- One-time admin verification codes (emailed on every admin sign-in)
CREATE TABLE IF NOT EXISTS login_codes (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  email        TEXT NOT NULL COLLATE NOCASE,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE members ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

-- Events become Tally-style: each has its own page, cover, and custom form.
ALTER TABLE events ADD COLUMN slug TEXT;
ALTER TABLE events ADD COLUMN cover_attachment_id TEXT;
ALTER TABLE events ADD COLUMN form_schema TEXT NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN capacity INTEGER;
ALTER TABLE events ADD COLUMN registration_closes_at TEXT;
ALTER TABLE events ADD COLUMN confirmation_message TEXT;
ALTER TABLE events ADD COLUMN collect_phone INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events(slug);

CREATE TABLE IF NOT EXISTS event_registrations (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id        TEXT,
  ref_code       TEXT NOT NULL,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL COLLATE NOCASE,
  phone          TEXT,
  guests         INTEGER NOT NULL DEFAULT 0,
  answers        TEXT NOT NULL DEFAULT '{}',         -- JSON { fieldId: value }
  status         TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | waitlist | cancelled
  checked_in_at  TEXT,
  ip_hash        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reg_event ON event_registrations(event_id, status);
CREATE INDEX IF NOT EXISTS idx_reg_email ON event_registrations(email);

-- Weekly announcement letter
CREATE TABLE IF NOT EXISTS subscribers (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | active | unsubscribed
  token            TEXT NOT NULL UNIQUE,              -- confirm / unsubscribe token
  source           TEXT,                              -- footer | join | google | admin
  user_id          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at     TEXT,
  unsubscribed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);

CREATE TABLE IF NOT EXISTS announcements (
  id              TEXT PRIMARY KEY,
  subject         TEXT NOT NULL,
  preheader       TEXT,
  heading         TEXT NOT NULL,
  body            TEXT NOT NULL,                      -- plain text with blank-line paragraphs
  scripture_text  TEXT,
  scripture_ref   TEXT,
  services        TEXT NOT NULL DEFAULT '[]',         -- JSON [{title, when, location, note}]
  include_events  INTEGER NOT NULL DEFAULT 1,         -- auto-add this week's published events
  cta_label       TEXT,
  cta_url         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',      -- draft | scheduled | sending | sent | cancelled
  scheduled_for   TEXT,
  started_at      TEXT,
  sent_at         TEXT,
  recipients      INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ann_status ON announcements(status, scheduled_for);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id               TEXT PRIMARY KEY,
  announcement_id  TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  subscriber_id    TEXT NOT NULL,
  email            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  error            TEXT,
  sent_at          TEXT,
  UNIQUE (announcement_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON email_deliveries(announcement_id, status);

-- Transactional email log (codes, confirmations, welcomes)
CREATE TABLE IF NOT EXISTS email_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email    TEXT NOT NULL,
  template    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL,                          -- sent | failed | skipped
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('tagline', 'A community-centred, Bible-based church in the heart of Sandton.'),
  ('service_summary', 'Join us every Sunday — see upcoming services for times.');
UPDATE settings SET value = 'Join us every Sunday — see upcoming services for times.' WHERE key = 'service_summary' AND value LIKE 'Youth gatherings%';
UPDATE settings SET value = 'Sandton City Church' WHERE key = 'youth_name';
