-- Admin sign-in window: the session itself lasts 30 days (a normal member sign-in), while admin
-- powers last 12 hours and renew while the admin is active. When they lapse, only the emailed code
-- is needed again (no Google pop-up, which can show as a blank sheet in installed iPhone apps).
ALTER TABLE sessions ADD COLUMN admin_until TEXT;

-- Service records can be "no service this week" (with the reason) and note who MC'd.
ALTER TABLE service_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'held';   -- held | cancelled
ALTER TABLE service_sessions ADD COLUMN cancel_reason TEXT;
ALTER TABLE service_sessions ADD COLUMN mc TEXT;
ALTER TABLE service_sessions ADD COLUMN source TEXT;                             -- e.g. 'spreadsheet' for imported history

-- Money in and out per ministry that isn't a service offering or event ticket
-- (e.g. the youth "bags" contributed to monthlies, quarterlies and conventions).
CREATE TABLE IF NOT EXISTS ministry_ledger (
  id             TEXT PRIMARY KEY,
  ministry_group TEXT NOT NULL,
  date           TEXT NOT NULL,              -- YYYY-MM-DD
  direction      TEXT NOT NULL DEFAULT 'out', -- out | in
  category       TEXT NOT NULL,
  note           TEXT,
  amount_cents   INTEGER NOT NULL,
  source         TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_group_date ON ministry_ledger (ministry_group, date);

-- Weekly service reminders: members and letter subscribers can opt out of these specifically.
ALTER TABLE subscribers ADD COLUMN service_reminders INTEGER NOT NULL DEFAULT 1;
ALTER TABLE members ADD COLUMN service_reminders INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS reminder_runs (
  service_id TEXT NOT NULL,
  date       TEXT NOT NULL,
  sent       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (service_id, date)
);
ALTER TABLE weekly_services ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;   -- send a reminder email the day before

-- Youth Ministry 2026 so far, imported from the youth team's spreadsheet (no email addresses imported).
-- Note: the 27 Feb offering (R1 945,20) was stored as text in the sheet, so the sheet's own totals left it out; it is included here.
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-01-02', 'svc-fri-youth', '2026-01-02', 'held', 'Youth Monthly', 'Youth Monthly', NULL, 70, 195000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-02-06', 'svc-fri-youth', '2026-02-06', 'held', '1st service: Reflection Night', 'Reflection Night', 'Phil', 19, 42000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-02-13', 'svc-fri-youth', '2026-02-13', 'held', 'Contending for the faith (part 1)', 'Siya Thwala (facilitator)', 'Sisikelelwe / Noluthando Jali', 15, 60900, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-02-20', 'svc-fri-youth', '2026-02-20', 'held', 'Contending for the faith (part 2)', 'Pastor (Q&A)', 'Simphiwe Chauke', 25, 77500, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-02-27', 'svc-fri-youth', '2026-02-27', 'held', 'Youth Prayer Night', 'Sinhle / Mbali / Siya Thwala', 'Sboshy', 47, 194520, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-03-06', 'svc-fri-youth', '2026-03-06', 'held', 'Preparing our hands for evangelism (part 1)', 'Discussion night', 'Mbali', 22, 86000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-03-13', 'svc-fri-youth', '2026-03-13', 'held', 'Preparing our hands for effective evangelism (part 2)', 'Pastor Joe', 'Nomvuzo', 25, 57700, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-03-20', 'svc-fri-youth', '2026-03-20', 'held', 'Preparing our hearts for evangelism (part 3)', 'Pastor Joe', 'Kagiso', 20, 65000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-03-27', 'svc-fri-youth', '2026-03-27', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'United church prayer', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-04-03', 'svc-fri-youth', '2026-04-03', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Easter weekend', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-04-10', 'svc-fri-youth', '2026-04-10', 'held', 'Anxiety & Faith', 'Discussion', NULL, 15, 51000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-04-17', 'svc-fri-youth', '2026-04-17', 'held', 'The story of Joseph', 'Phil', 'Phil', 17, 26000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-04-24', 'svc-fri-youth', '2026-04-24', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Youth Monthly', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-05-01', 'svc-fri-youth', '2026-05-01', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Picnic Friday cancelled due to weather', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-05-08', 'svc-fri-youth', '2026-05-08', 'held', 'Career month: Film & TV and Accounting', 'Nomvuzo Ganta', 'Phil', 20, 43000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-05-15', 'svc-fri-youth', '2026-05-15', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'In honour of Sis Kolosa', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-05-22', 'svc-fri-youth', '2026-05-22', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Youth Quarterly', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-05-29', 'svc-fri-youth', '2026-05-29', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Church prayer night', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-06-05', 'svc-fri-youth', '2026-06-05', 'held', 'Movie Night', NULL, NULL, NULL, 24000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-06-12', 'svc-fri-youth', '2026-06-12', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Youth conference', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-06-19', 'svc-fri-youth', '2026-06-19', 'held', 'Career month: Medical Laboratory Science', 'Kagiso', 'Thandi Ndala', NULL, NULL, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-06-26', 'svc-fri-youth', '2026-06-26', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Convention', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-07-10', 'svc-fri-youth', '2026-07-10', 'cancelled', 'No youth service', NULL, NULL, NULL, NULL, 'Mothers'' Quarterly long weekend', 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-07-17', 'svc-fri-youth', '2026-07-17', 'held', 'Guest speaker', 'Sango Mwezi', NULL, NULL, 0, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-07-24', 'svc-fri-youth', '2026-07-24', 'held', 'Guest speaker', 'Gift Mofokeng', NULL, NULL, 43000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO service_sessions (id, service_id, date, status, topic, speaker, mc, attendance, offering_cents, cancel_reason, source, created_by) VALUES ('yx-2026-08-07', 'svc-fri-youth', '2026-08-07', 'held', 'Youth service', NULL, NULL, NULL, 88000, NULL, 'spreadsheet', 'import');
INSERT OR IGNORE INTO ministry_ledger (id, ministry_group, date, direction, category, amount_cents, source, created_by) VALUES ('yl-2026-01', 'youth', '2026-02-01', 'out', 'Youth Monthly (first one)', 175000, 'spreadsheet', 'import');
INSERT OR IGNORE INTO ministry_ledger (id, ministry_group, date, direction, category, amount_cents, source, created_by) VALUES ('yl-2026-02', 'youth', '2026-02-01', 'out', 'Youth Seminar (February)', 120000, 'spreadsheet', 'import');
INSERT OR IGNORE INTO ministry_ledger (id, ministry_group, date, direction, category, amount_cents, source, created_by) VALUES ('yl-2026-03', 'youth', '2026-04-01', 'out', 'Youth Monthly bag', 130000, 'spreadsheet', 'import');
INSERT OR IGNORE INTO ministry_ledger (id, ministry_group, date, direction, category, amount_cents, source, created_by) VALUES ('yl-2026-04', 'youth', '2026-05-01', 'out', 'Youth Quarterly bag', 120000, 'spreadsheet', 'import');
INSERT OR IGNORE INTO ministry_ledger (id, ministry_group, date, direction, category, amount_cents, source, created_by) VALUES ('yl-2026-05', 'youth', '2026-07-01', 'out', 'Youth Convention bag', 220000, 'spreadsheet', 'import');
INSERT OR IGNORE INTO ministry_ledger (id, ministry_group, date, direction, category, amount_cents, source, created_by) VALUES ('yl-2026-06', 'youth', '2026-08-01', 'out', 'Youth Monthly bag', 130000, 'spreadsheet', 'import');
