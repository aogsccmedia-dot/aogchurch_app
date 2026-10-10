-- Ministry groups, event income, idempotent door scans, and the weekly services manager.

-- Every event belongs to a ministry group (for stats and the board report).
ALTER TABLE events ADD COLUMN ministry_group TEXT NOT NULL DEFAULT 'church';
-- Money received outside online registrations (cash at the door, sponsorships), in Rands.
ALTER TABLE events ADD COLUMN extra_income INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN extra_income_note TEXT;
UPDATE events SET ministry_group = 'youth' WHERE category = 'night' OR lower(title) LIKE '%youth%';

-- Door scans: the device sends a scan id, so a retried request after a dropped connection
-- is recognised as the same scan (shows "Checked in", never a false "Already scanned").
ALTER TABLE tickets ADD COLUMN checkin_scan_id TEXT;

-- Regular weekly services (editable in Admin → Weekly services). day: 0 = Sunday … 6 = Saturday.
CREATE TABLE IF NOT EXISTS weekly_services (
  id             TEXT PRIMARY KEY,
  day            INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  title          TEXT NOT NULL,
  start_time     TEXT,                    -- "18:00"
  end_time       TEXT,                    -- "20:00"
  note           TEXT,
  ministry_group TEXT NOT NULL DEFAULT 'church',
  frequency      TEXT NOT NULL DEFAULT 'weekly',   -- weekly | twice_monthly | monthly
  active         INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO weekly_services (id, day, title, start_time, end_time, note, ministry_group, frequency, sort) VALUES
  ('svc-mon-prayer',     1, 'Prayer',            '18:00', '20:00', 'Weekly prayer meeting',                        'prayer',    'weekly',        10),
  ('svc-tue-cells',      2, 'Cell groups',       '18:00', '20:00', 'Home cells',                                   'cells',     'twice_monthly', 20),
  ('svc-wed-choir',      3, 'Choir practice',    '18:00', '19:30', NULL,                                           'choir',     'weekly',        30),
  ('svc-thu-mothers',    4, 'Mothers'' service', '18:00', '20:00', NULL,                                           'mothers',   'weekly',        40),
  ('svc-thu-fathers',    4, 'Fathers'' service', '18:00', '20:00', NULL,                                           'fathers',   'weekly',        41),
  ('svc-thu-daughters',  4, 'Daughters'' service','18:00','20:00', NULL,                                           'daughters', 'weekly',        42),
  ('svc-fri-youth',      5, 'Youth service',     '18:00', '20:00', 'For teens and young adults',                   'youth',     'weekly',        50),
  ('svc-sun-main',       0, 'Main service',      '08:45', '11:00', 'Everyone welcome: family, kids and youth',     'church',    'weekly',        60);

-- One record per service held: what was preached, the poster, and what God did that day.
CREATE TABLE IF NOT EXISTS service_sessions (
  id                    TEXT PRIMARY KEY,
  service_id            TEXT NOT NULL REFERENCES weekly_services(id) ON DELETE CASCADE,
  date                  TEXT NOT NULL,             -- YYYY-MM-DD (SAST)
  topic                 TEXT NOT NULL,
  speaker               TEXT,
  scripture             TEXT,
  summary               TEXT,
  poster_attachment_id  TEXT,
  attendance            INTEGER,                   -- everyone present
  first_time_visitors   INTEGER,
  children              INTEGER,
  salvations            INTEGER,                   -- gave their lives to Christ
  rededications         INTEGER,
  spirit_baptisms       INTEGER,                   -- baptised in the Holy Spirit
  water_baptisms        INTEGER,
  testimonies           INTEGER,                   -- healings / testimonies shared
  volunteers            INTEGER,                   -- people serving
  offering_cents        INTEGER,
  tithes_cents          INTEGER,
  other_income_cents    INTEGER,
  notes                 TEXT,
  created_by            TEXT,
  updated_by            TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (service_id, date)
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON service_sessions (date);
