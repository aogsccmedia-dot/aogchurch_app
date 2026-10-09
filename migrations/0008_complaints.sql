-- Complaints from approved members (status = 'member'), handled by the admin through the dashboard.
CREATE TABLE IF NOT EXISTS complaints (
  id            TEXT PRIMARY KEY,
  ref_code      TEXT NOT NULL UNIQUE,
  member_id     TEXT NOT NULL REFERENCES members(id),
  user_id       TEXT,
  category      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  details       TEXT NOT NULL,
  desired_outcome TEXT,
  confidential  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'received',   -- received | in_review | resolved | closed
  response      TEXT,
  responded_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status, created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_member ON complaints (member_id);
