-- Visitors: people who sign in as guests. Never verified as members; they can see events, get tickets and manage
-- those tickets only (no messaging leaders, complaints, voting, prayer wall or member tools).
ALTER TABLE users ADD COLUMN visitor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN phone TEXT;
