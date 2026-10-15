-- FreeCreator Online: phones as extra cameras for the Studio (WebRTC signalling), and who may use the phone version.
CREATE TABLE IF NOT EXISTS cam_rooms (
  code        TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cam_links (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  label       TEXT,
  offer       TEXT NOT NULL,
  answer      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cam_links_code ON cam_links(code, answer);
-- Phone access to FreeCreator Online: the main admin always, plus these accounts.
INSERT OR IGNORE INTO settings (key, value) VALUES ('freecreator_mobile', '["philasandendunge@gmail.com"]');
