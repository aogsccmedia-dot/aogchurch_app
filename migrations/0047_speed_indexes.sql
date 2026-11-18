-- Speed: the public pages and the postponement/reminder mailers look these up on every visit or cron run.
CREATE INDEX IF NOT EXISTS idx_events_pub_starts ON events (is_published, starts_at);
CREATE INDEX IF NOT EXISTS idx_reg_event_status ON event_registrations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_email_log_template_to ON email_log (template, to_email);
