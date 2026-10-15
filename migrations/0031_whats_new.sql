-- One-time "what's new" email to the church family (members who allow email, plus the team).
-- Sent in small batches by the cron job; each address once.
CREATE TABLE IF NOT EXISTS whats_new_mail (
  email    TEXT PRIMARY KEY COLLATE NOCASE,
  name     TEXT,
  leader   INTEGER NOT NULL DEFAULT 0,
  status   TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed | skipped
  sent_at  TEXT,
  error    TEXT
);
INSERT OR IGNORE INTO whats_new_mail (email, name, leader)
  SELECT lower(trim(u.email)), COALESCE(NULLIF(u.given_name, ''), u.name), 1 FROM admin_roles r JOIN users u ON u.id = r.user_id WHERE u.email LIKE '%@%';
INSERT OR IGNORE INTO whats_new_mail (email, name, leader)
  SELECT lower(trim(email)), COALESCE(NULLIF(trim(preferred_name), ''), first_name), 0 FROM members
   WHERE email LIKE '%@%' AND comm_email = 1 AND status NOT IN ('revoked', 'inactive') ORDER BY created_at DESC;
