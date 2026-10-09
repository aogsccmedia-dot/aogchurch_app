-- Keep the full message for failed emails so the admin can resend them later.
ALTER TABLE email_log ADD COLUMN payload TEXT;
CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log (status, created_at);

-- Church social media (editable in Admin → Site settings).
INSERT INTO settings (key, value) VALUES
  ('youtube_url', 'https://www.youtube.com/@aogsandtoncitychurchtv9989'),
  ('tiktok_url', 'https://www.tiktok.com/@aog.sandton.city'),
  ('facebook_url', 'https://www.facebook.com/AOGSandtonCity/'),
  ('instagram_url', 'https://www.instagram.com/aogsandtoncitychurch')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR settings.value = '';

-- Youth Worship Night banking details (EFT, reference = full names).
UPDATE events SET payment_instructions = 'Bank: Capitec Bank
Account type: Cheque account
Account name: Youth Worship Night
Account holder: KM Moloto
Account number: 1623526815
Reference: Your full names (mandatory)'
WHERE slug = 'youth-worship-night-2026' AND (payment_instructions IS NULL OR payment_instructions = '');

-- Cookie consent records (POPIA accountability). Anonymous: a random visitor id, never an IP or account.
CREATE TABLE IF NOT EXISTS cookie_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  essential INTEGER NOT NULL DEFAULT 1,
  functional INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_created ON cookie_consents (created_at);
