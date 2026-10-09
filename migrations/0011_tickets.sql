-- Digital tickets: one per person on a confirmed registration, each with a unique QR code.
-- A ticket can be checked in once; scanning a copy again shows when it was already used.
CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  registration_id TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  quantity        INTEGER NOT NULL,
  holder_name     TEXT NOT NULL,
  holder_email    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'valid',     -- valid | void
  checked_in_at   TEXT,
  checked_in_by   TEXT,
  scan_count      INTEGER NOT NULL DEFAULT 0,
  last_scan_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_registration ON tickets (registration_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets (event_id, checked_in_at);
