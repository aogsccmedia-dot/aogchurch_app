-- "Ask SCC": the members' chat assistant (a concierge that hands questions to specialist agents).
-- We log how each answer was made (which agent, AI or built-in, speed, errors, thumbs up/down) so the
-- AI rollout can be widened or rolled back safely. The question text itself is never stored.
CREATE TABLE IF NOT EXISTS assistant_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  agent       TEXT NOT NULL,
  mode        TEXT NOT NULL,              -- ai | rules
  model       TEXT,
  prompt_ver  TEXT,
  latency_ms  INTEGER,
  ok          INTEGER NOT NULL DEFAULT 1, -- 0 = the AI failed and the built-in answer was used
  error       TEXT,
  rating      INTEGER,                    -- 1 = helpful, -1 = not helpful
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_log_time ON assistant_log (created_at);

-- Start the AI answers as a canary: 10% of members, widened automatically while it stays healthy.
INSERT OR IGNORE INTO settings (key, value) VALUES ('assistant_enabled', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('assistant_ai_pct', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('assistant_ai_auto', '1');

-- People on the team (admins, youth leaders) can ask the main admin for more access from their portal.
CREATE TABLE IF NOT EXISTS access_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT,
  current_role  TEXT,
  wants         TEXT NOT NULL,              -- JSON array of permission keys, or ["admin"]
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | declined
  decided_by    TEXT,
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_access_requests ON access_requests (status, created_at);

-- Weekly prayer reminder: when it was last sent (so it goes once a week).
INSERT OR IGNORE INTO settings (key, value) VALUES ('prayer_weekly_enabled', '1');

-- Youth leaders can now approve tickets for youth events by default.
UPDATE admin_roles SET perms = json_insert(perms, '$[#]', 'youth_tickets')
 WHERE role = 'youth_leader' AND perms IS NOT NULL AND json_valid(perms) AND perms NOT LIKE '%youth_tickets%';

-- Weekly prayer wall email to members: who opted out, and who already got this week's (so a slow week resumes).
CREATE TABLE IF NOT EXISTS prayer_weekly (
  email       TEXT PRIMARY KEY,
  token       TEXT NOT NULL,
  opted_out   INTEGER NOT NULL DEFAULT 0,
  last_sent   TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Admins now work like youth leaders: only what the main admin ticks. They start with reports and weekly services.
UPDATE admin_roles SET perms = '["reports","services"]' WHERE role = 'admin';
