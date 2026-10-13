-- Youth leaders (a limited admin role with permissions the main admin chooses), Friday capture and member voting.
ALTER TABLE admin_roles ADD COLUMN perms TEXT;   -- JSON array of permission keys (youth leaders only)

CREATE TABLE IF NOT EXISTS polls (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  event_name    TEXT,
  description   TEXT,
  opens_at      TEXT NOT NULL,       -- ISO time voting opens
  closes_at     TEXT NOT NULL,       -- ISO time voting closes
  candidates    TEXT NOT NULL DEFAULT 'list',   -- 'list' (chosen members) | 'all' (any confirmed member)
  show_live     INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | closed (manual override) | draft
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS poll_candidates (
  poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poll_id, member_id)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id      TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter_id     TEXT NOT NULL,      -- members.id of the voter
  member_id    TEXT NOT NULL,      -- members.id voted for
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (poll_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_member ON poll_votes(poll_id, member_id);
