-- Admin verification codes: track whether the email actually went out, so the code screen can say so (and retry).
ALTER TABLE login_codes ADD COLUMN delivery TEXT;   -- pending | sent | failed
ALTER TABLE login_codes ADD COLUMN sent_at TEXT;
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes (email, created_at);
