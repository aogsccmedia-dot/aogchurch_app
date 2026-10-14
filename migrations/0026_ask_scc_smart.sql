-- Ask SCC: the smart assistant (open-source Llama on Workers AI with church knowledge retrieval) for everyone.
INSERT INTO settings (key, value) VALUES ('assistant_ai_pct', '100') ON CONFLICT(key) DO UPDATE SET value = '100';
