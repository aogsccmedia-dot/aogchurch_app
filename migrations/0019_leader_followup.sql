-- Every confirmed member gets a leader from the admin team (shared out fairly), who follows up and keeps in touch.
ALTER TABLE members ADD COLUMN leader_user_id TEXT;
ALTER TABLE members ADD COLUMN leader_assigned_at TEXT;
ALTER TABLE members ADD COLUMN followup_status TEXT;          -- pending | not_yet | met
ALTER TABLE members ADD COLUMN followup_method TEXT;          -- whatsapp | call | email | in_person
ALTER TABLE members ADD COLUMN followup_note TEXT;
ALTER TABLE members ADD COLUMN followup_at TEXT;              -- when they first connected
ALTER TABLE members ADD COLUMN followup_next_ask_at TEXT;     -- when we next ask the leader "have you connected?"
ALTER TABLE members ADD COLUMN followup_asks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN last_contact_at TEXT;
CREATE INDEX IF NOT EXISTS idx_members_leader ON members (leader_user_id);
CREATE INDEX IF NOT EXISTS idx_members_followup ON members (followup_status, followup_next_ask_at);

-- Each time a leader is in touch with someone (keeps the relationship visible).
CREATE TABLE IF NOT EXISTS member_contacts (
  id             TEXT PRIMARY KEY,
  member_id      TEXT NOT NULL,
  leader_user_id TEXT NOT NULL,
  method         TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_member ON member_contacts (member_id, created_at);

-- One-tap links in the leader's follow-up email (hashed).
CREATE TABLE IF NOT EXISTS followup_links (
  token_hash     TEXT PRIMARY KEY,
  member_id      TEXT NOT NULL,
  leader_user_id TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
