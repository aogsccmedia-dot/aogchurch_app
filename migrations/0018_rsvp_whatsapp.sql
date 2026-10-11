-- "Are you coming?" answers for weekly services (from email, WhatsApp or the website).
CREATE TABLE IF NOT EXISTS service_rsvps (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  contact     TEXT NOT NULL COLLATE NOCASE,    -- email address or WhatsApp number (+27…)
  name        TEXT,
  response    TEXT NOT NULL,                   -- yes | no
  reason_code TEXT,                            -- only if they chose to share
  reason      TEXT,
  channel     TEXT NOT NULL,                   -- email | whatsapp | web
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (service_id, date, contact)
);
CREATE INDEX IF NOT EXISTS idx_rsvps_service_date ON service_rsvps (service_id, date);

-- One-tap RSVP links in reminder emails (hashed).
CREATE TABLE IF NOT EXISTS rsvp_links (
  token_hash TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  date       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  name       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- WhatsApp (Meta Cloud API): who opted out, and where a conversation is up to.
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  phone           TEXT PRIMARY KEY,            -- digits only, e.g. 27821234567
  name            TEXT,
  opted_out       INTEGER NOT NULL DEFAULT 0,
  pending         TEXT,                        -- e.g. "reason|svc-fri-youth|2026-10-16" while we wait for a reason
  last_inbound_at TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS whatsapp_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  direction  TEXT NOT NULL,                    -- out | in
  phone      TEXT NOT NULL,
  kind       TEXT NOT NULL,                    -- template | text | buttons | list | inbound
  summary    TEXT,
  status     TEXT,                             -- sent | failed | received
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_walog_created ON whatsapp_log (created_at);
