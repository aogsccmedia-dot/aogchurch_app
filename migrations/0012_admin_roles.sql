-- Delegated admins: the super admin (ADMIN_EMAIL) can give registered members admin access.
-- They sign in with Google + a code emailed to their own address, and can do everything
-- except delete people or manage admin roles.
CREATE TABLE IF NOT EXISTS admin_roles (
  user_id     TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'admin',
  granted_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
