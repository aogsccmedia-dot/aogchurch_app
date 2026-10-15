-- Unique visitors per connection: a salted, one-way hash of the IP address (the address itself is never stored).
ALTER TABLE analytics_events ADD COLUMN ip TEXT;
ALTER TABLE analytics_events ADD COLUMN region TEXT;
CREATE INDEX IF NOT EXISTS idx_an_ip ON analytics_events (ip, day);
