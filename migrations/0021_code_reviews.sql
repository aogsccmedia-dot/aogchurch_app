-- Code changes from collaborators (GitHub pull requests): alerts log and the main admin's decisions.
CREATE TABLE IF NOT EXISTS code_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo        TEXT NOT NULL,
  kind        TEXT NOT NULL,          -- pull_request | check_suite | issues | push | review
  action      TEXT,
  number      INTEGER,
  title       TEXT,
  author      TEXT,
  url         TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_code_events_created ON code_events(created_at);
