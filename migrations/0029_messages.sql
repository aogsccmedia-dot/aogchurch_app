-- Messages: members (and anyone signed in) can message a church leader; leaders reply. Not member-to-member.
CREATE TABLE IF NOT EXISTS chat_threads (
  id              TEXT PRIMARY KEY,
  starter_id      TEXT NOT NULL,          -- the person who started it
  leader_id       TEXT NOT NULL,          -- the leader they wrote to
  last_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_preview    TEXT,
  last_sender     TEXT,
  starter_unread  INTEGER NOT NULL DEFAULT 0,
  leader_unread   INTEGER NOT NULL DEFAULT 0,
  starter_mailed  TEXT,
  leader_mailed   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (starter_id, leader_id)
);
CREATE INDEX IF NOT EXISTS idx_threads_starter ON chat_threads (starter_id, last_at);
CREATE INDEX IF NOT EXISTS idx_threads_leader ON chat_threads (leader_id, last_at);
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_messages (thread_id, created_at);
-- A leader's ministry title shown to members, e.g. "Daughters' Ministry leader" (set by the main admin).
ALTER TABLE admin_roles ADD COLUMN title TEXT;
