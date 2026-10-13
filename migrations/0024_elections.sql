-- Elections: a vote now fills named roles (e.g. "Youth chairperson") over one or more timed rounds.
-- Round 1: any confirmed member who has been saved for at least five years can be chosen (from their join form).
-- Later rounds: the top few from the round before. When the last round closes, the winners are appointed.
-- Members are reminded every two weeks before voting starts, to pray, and when each round opens.
ALTER TABLE polls ADD COLUMN rounds INTEGER NOT NULL DEFAULT 1;
ALTER TABLE polls ADD COLUMN round_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE polls ADD COLUMN gap_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE polls ADD COLUMN runoff INTEGER NOT NULL DEFAULT 3;
ALTER TABLE polls ADD COLUMN min_saved_years INTEGER NOT NULL DEFAULT 5;
ALTER TABLE polls ADD COLUMN last_reminder_at TEXT;
ALTER TABLE polls ADD COLUMN reminded_rounds TEXT;          -- JSON array of round numbers whose "voting is open" email went out
ALTER TABLE polls ADD COLUMN completed_at TEXT;

CREATE TABLE IF NOT EXISTS poll_roles (
  id          TEXT PRIMARY KEY,
  poll_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  seats       INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poll_roles ON poll_roles (poll_id, sort);

CREATE TABLE IF NOT EXISTS poll_rounds (
  poll_id   TEXT NOT NULL,
  round     INTEGER NOT NULL,
  opens_at  TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, round)
);

-- One ballot per member, per role, per round. Secret: results only ever show totals.
CREATE TABLE IF NOT EXISTS poll_ballots (
  poll_id    TEXT NOT NULL,
  round      INTEGER NOT NULL,
  role_id    TEXT NOT NULL,
  voter_id   TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (poll_id, round, role_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_ballots_count ON poll_ballots (poll_id, round, role_id, member_id);

CREATE TABLE IF NOT EXISTS poll_finalists (
  poll_id   TEXT NOT NULL,
  round     INTEGER NOT NULL,
  role_id   TEXT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (poll_id, round, role_id, member_id)
);

CREATE TABLE IF NOT EXISTS poll_appointments (
  poll_id      TEXT NOT NULL,
  role_id      TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  votes        INTEGER NOT NULL DEFAULT 0,
  appointed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (poll_id, role_id, member_id)
);
