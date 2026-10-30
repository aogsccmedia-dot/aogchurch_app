-- Ask SCC (the members' AI chat) has been removed completely: its conversation log and its settings go too.
DROP TABLE IF EXISTS assistant_log;
DELETE FROM settings WHERE key LIKE 'assistant%';
