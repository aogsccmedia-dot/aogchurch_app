-- Messages feel live: who is typing right now, and when each side last saw the conversation ("Seen").
ALTER TABLE chat_threads ADD COLUMN starter_typing_at TEXT;
ALTER TABLE chat_threads ADD COLUMN leader_typing_at TEXT;
ALTER TABLE chat_threads ADD COLUMN starter_seen_at TEXT;
ALTER TABLE chat_threads ADD COLUMN leader_seen_at TEXT;
