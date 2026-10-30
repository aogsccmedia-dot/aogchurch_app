-- Verified pastors (purple star) and discipleship classes: scheduled by pastors and the main admin, in person or online
-- in the church's own video room, with optional automatic notes sent to attendees as a PDF.

-- Pastors are marked by the main admin only, and only members can be pastors.
CREATE TABLE IF NOT EXISTS pastors (
  user_id     TEXT PRIMARY KEY,
  title       TEXT,                       -- e.g. "Senior Pastor"
  verified_by TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Discipleship classes start as "coming soon"; pastors or the main admin open them.
INSERT OR IGNORE INTO settings (key, value) VALUES ('discipleship_status', 'soon');

CREATE TABLE IF NOT EXISTS dc_classes (
  id          TEXT PRIMARY KEY,
  track       TEXT NOT NULL DEFAULT 'foundations',
  title       TEXT NOT NULL,
  starts_at   TEXT NOT NULL,              -- ISO, UTC
  minutes     INTEGER NOT NULL DEFAULT 60,
  mode        TEXT NOT NULL DEFAULT 'online',   -- online | in_person
  location    TEXT,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | live | ended | cancelled
  notes_on    INTEGER NOT NULL DEFAULT 0,
  summary     TEXT,                       -- JSON from the end-of-class summary
  notes_sent  TEXT,
  created_by  TEXT NOT NULL,
  updated_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_dc_classes_start ON dc_classes (starts_at);

-- Who joined an online class (and is still there: seen_at is refreshed while they're in the room).
CREATE TABLE IF NOT EXISTS dc_attendance (
  class_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at     TEXT,
  PRIMARY KEY (class_id, user_id)
);

-- Connection messages between browsers in the video room (deleted as soon as they're picked up).
CREATE TABLE IF NOT EXISTS dc_signals (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- offer | answer
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_dc_signals_to ON dc_signals (class_id, to_id);

-- What was said while notes were on, per speaker (kept 60 days after the class).
CREATE TABLE IF NOT EXISTS dc_transcript (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  said_at     TEXT NOT NULL,
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dc_transcript_class ON dc_transcript (class_id, said_at);
