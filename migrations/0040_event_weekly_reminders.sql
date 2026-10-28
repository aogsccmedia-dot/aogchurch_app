-- Weekly ticket reminders (Wednesdays 12:00 SAST): one row per booking per week, so nobody gets two in a week.
CREATE TABLE IF NOT EXISTS event_reminders (
  registration_id TEXT NOT NULL,
  week            TEXT NOT NULL,          -- the Wednesday's date (YYYY-MM-DD, South African time)
  sent_at         TEXT NOT NULL,
  PRIMARY KEY (registration_id, week)
);
