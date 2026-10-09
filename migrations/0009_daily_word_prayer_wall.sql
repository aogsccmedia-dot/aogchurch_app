-- Daily Word: one verse a day that the whole church reads together; check-ins build a streak.
CREATE TABLE IF NOT EXISTS word_checkins (
  user_id    TEXT NOT NULL,
  day        TEXT NOT NULL,                 -- YYYY-MM-DD (Africa/Johannesburg)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_word_checkins_day ON word_checkins (day);

-- Prayer Wall: requests shared with the church family (approved by a leader first), "I prayed" taps, answered prayers.
CREATE TABLE IF NOT EXISTS prayer_wall (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  display_name  TEXT,                      -- first name, or NULL to post as "Someone"
  request       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | hidden
  prayed_count  INTEGER NOT NULL DEFAULT 0,
  answered      INTEGER NOT NULL DEFAULT 0,
  answered_note TEXT,
  answered_at   TEXT,
  approved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prayer_wall_status ON prayer_wall (status, created_at);
CREATE TABLE IF NOT EXISTS prayer_wall_prayers (
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (post_id, user_id)
);
