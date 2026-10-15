-- FreeCreator Online church workspaces. Each church sees only its own data.
-- Sandton City Church's workspace includes its approved members and team automatically; other churches add their members by hand.
CREATE TABLE IF NOT EXISTS fc_churches (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  city           TEXT,
  contact_email  TEXT,
  note           TEXT,
  owner_user_id  TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending | active | declined
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO fc_churches (id, name, city, status) VALUES ('scc', 'AOG Sandton City Church', 'Sandton', 'active');
CREATE TABLE IF NOT EXISTS fc_members (
  church_id   TEXT NOT NULL,
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL DEFAULT 'member',       -- owner | admin | member
  added_by    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (church_id, email)
);
CREATE TABLE IF NOT EXISTS fc_library (
  church_id   TEXT NOT NULL,
  coll        TEXT NOT NULL,                        -- songs | shows
  id          TEXT NOT NULL,
  data        TEXT,
  deleted     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT,
  PRIMARY KEY (church_id, coll, id)
);
CREATE INDEX IF NOT EXISTS idx_fc_library_since ON fc_library(church_id, updated_at);
CREATE TABLE IF NOT EXISTS fc_presence (
  church_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  name       TEXT,
  seen_at    INTEGER NOT NULL,
  PRIMARY KEY (church_id, user_id)
);
ALTER TABLE cam_rooms ADD COLUMN church_id TEXT;
