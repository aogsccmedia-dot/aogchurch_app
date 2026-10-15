-- FreeCreator Online: one church per person, and Sandton City Church's media team.
-- Each email can belong to only one church workspace at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fc_members_one_church ON fc_members(email);
-- Media status (runs the FreeCreator workspace for Sandton City Church). The main admin is the owner already.
INSERT OR IGNORE INTO fc_members (church_id, email, role, added_by) VALUES ('scc', 'philasandendunge@gmail.com', 'media', 'system');
