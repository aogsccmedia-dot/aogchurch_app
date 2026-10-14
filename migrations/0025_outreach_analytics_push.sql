-- Evangelism contacts, Call Office check-ups, discipleship sign-ups, first-party analytics and phone notifications.

-- People met through evangelism (logged by the team in the app) or who responded on the Evangelism page.
CREATE TABLE IF NOT EXISTS outreach_contacts (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  area             TEXT,
  notes            TEXT,
  decision         TEXT NOT NULL DEFAULT 'interested',   -- prayed | interested | visit | prayer | class
  source           TEXT NOT NULL DEFAULT 'team',          -- team | web
  brought_by       TEXT,                                  -- user id of the team member
  brought_by_name  TEXT,
  ip_hash          TEXT,
  status           TEXT NOT NULL DEFAULT 'new',           -- new | no_answer | called | connected | closed
  last_note        TEXT,
  called_by        TEXT,
  called_at        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_contacts (status, created_at);
CREATE INDEX IF NOT EXISTS idx_outreach_by ON outreach_contacts (brought_by);

-- Call Office: every check-up call made to a member.
CREATE TABLE IF NOT EXISTS care_calls (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL,
  outcome     TEXT NOT NULL,                 -- spoke | no_answer | message | needs_help
  note        TEXT,
  called_by   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_care_calls_member ON care_calls (member_id, created_at);

-- Discipleship classes sign-ups.
CREATE TABLE IF NOT EXISTS discipleship_signups (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  track       TEXT NOT NULL DEFAULT 'foundations',
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'new',   -- new | placed | done
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Analytics: one row per page view or tap. No names or emails; visitor ids only with consent.
CREATE TABLE IF NOT EXISTS analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  day         TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- view | click
  path        TEXT,
  label       TEXT,
  ref         TEXT,                          -- referring site (host only)
  source      TEXT,                          -- utm_source or derived source
  country     TEXT,
  city        TEXT,
  device      TEXT,                          -- phone | tablet | computer
  browser     TEXT,
  os          TEXT,
  vid         TEXT,                          -- anonymous visitor id (only with analytics consent)
  sid         TEXT,                          -- session id (only with analytics consent)
  uid         TEXT,                          -- signed-in user id
  app         INTEGER NOT NULL DEFAULT 0,    -- opened as the installed app
  ms          INTEGER                        -- page load time
);
CREATE INDEX IF NOT EXISTS idx_an_day ON analytics_events (day, kind);
CREATE INDEX IF NOT EXISTS idx_an_vid ON analytics_events (vid, day);
CREATE INDEX IF NOT EXISTS idx_an_uid ON analytics_events (uid, day);

-- Phone notifications (Web Push) for the installed app and browsers.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT,
  auth        TEXT,
  user_id     TEXT,
  verse       INTEGER NOT NULL DEFAULT 1,    -- daily verse reminder (on by default)
  hour        INTEGER NOT NULL DEFAULT 6,    -- local hour (SAST) for the daily verse
  last_sent   TEXT,
  fails       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
