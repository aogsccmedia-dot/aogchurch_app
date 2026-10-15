-- Email + password sign-in for everyone (not just FreeCreator testers). Uses the existing users.password_hash and
-- users.email_verified_at columns. Everyone already here proved their email (Google or an emailed code).
UPDATE users SET email_verified_at = COALESCE(email_verified_at, last_login_at, created_at);
ALTER TABLE login_codes ADD COLUMN purpose TEXT;
ALTER TABLE login_codes ADD COLUMN payload TEXT;
