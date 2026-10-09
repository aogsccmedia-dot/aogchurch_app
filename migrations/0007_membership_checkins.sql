-- Membership check-ins: every 4 months members are emailed to confirm they're still part of
-- the church ("Still a member") or to revoke their membership.
ALTER TABLE members ADD COLUMN last_confirmed_at TEXT;
ALTER TABLE members ADD COLUMN next_checkin_at TEXT;
ALTER TABLE members ADD COLUMN checkin_token_hash TEXT;
ALTER TABLE members ADD COLUMN checkin_sent_at TEXT;
ALTER TABLE members ADD COLUMN checkin_reminded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN revoked_at TEXT;
ALTER TABLE members ADD COLUMN revoke_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_members_checkin ON members (next_checkin_at);
CREATE INDEX IF NOT EXISTS idx_members_checkin_token ON members (checkin_token_hash);
UPDATE members SET next_checkin_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+4 months') WHERE next_checkin_at IS NULL;
-- New members get their first check-in four months after joining.
CREATE TRIGGER IF NOT EXISTS trg_members_first_checkin AFTER INSERT ON members
WHEN NEW.next_checkin_at IS NULL
BEGIN
  UPDATE members SET next_checkin_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '+4 months') WHERE id = NEW.id;
END;
