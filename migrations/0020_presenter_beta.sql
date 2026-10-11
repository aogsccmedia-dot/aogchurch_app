-- SCC Presenter beta: email + password accounts, 20 tester slots, download log and feedback.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = COALESCE(last_login_at, created_at) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS password_pending (
  challenge   TEXT PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  name        TEXT,
  hash        TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_testers (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL COLLATE NOCASE,
  name             TEXT,
  slot             INTEGER NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 20),
  beta_key         TEXT NOT NULL UNIQUE,
  church           TEXT,
  role             TEXT,
  os               TEXT,
  downloads        INTEGER NOT NULL DEFAULT 0,
  last_download_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS beta_downloads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tester_id  TEXT NOT NULL REFERENCES beta_testers(id) ON DELETE CASCADE,
  os         TEXT NOT NULL,
  version    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS beta_feedback (
  id          TEXT PRIMARY KEY,
  tester_id   TEXT NOT NULL REFERENCES beta_testers(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,           -- app | web
  overall     INTEGER,
  ease        INTEGER,
  install_ok  TEXT,                    -- yes | no | partly (web form)
  used        TEXT,                    -- JSON array
  good        TEXT,
  problems    TEXT,
  missing     TEXT,
  recommend   TEXT,
  system      TEXT,                    -- JSON (only when the tester ticked "include computer details")
  version     TEXT,
  platform    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_beta_feedback_created ON beta_feedback(created_at);

-- The main admin account is never a leader: free up anyone assigned to it so the next run shares them fairly among Admin-role leaders.
UPDATE members SET leader_user_id = NULL, leader_assigned_at = NULL
 WHERE leader_user_id IN (SELECT id FROM users WHERE lower(email) = 'aogsccmedia@gmail.com');
