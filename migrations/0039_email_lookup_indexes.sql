-- Faster sign-in and member lookups: queries compare lower(email), which can't use a plain email index,
-- so each of these used to scan the whole table. Expression indexes match those lookups exactly.
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_members_email_lower ON members (lower(email));
CREATE INDEX IF NOT EXISTS idx_subscribers_email_lower ON subscribers (lower(email));
CREATE INDEX IF NOT EXISTS idx_reg_email_lower ON event_registrations (lower(email));
-- Chat badges look up members by their account.
CREATE INDEX IF NOT EXISTS idx_members_user_status ON members (user_id, status);
