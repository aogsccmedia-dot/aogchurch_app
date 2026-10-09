-- Track the member welcome email, so anyone who didn't get it (e.g. while email sending was being set up)
-- receives it automatically.
ALTER TABLE members ADD COLUMN welcome_sent_at TEXT;
