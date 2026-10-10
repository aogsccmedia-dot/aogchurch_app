-- One-tap links in service reminder emails ("stop service reminders"), stored hashed.
CREATE TABLE IF NOT EXISTS reminder_links (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reminder_links_created ON reminder_links (created_at);
