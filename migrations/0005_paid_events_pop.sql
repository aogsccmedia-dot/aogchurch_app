-- Paid events: bank transfer + proof of payment (POP) upload + admin approval.
ALTER TABLE events ADD COLUMN ticket_price INTEGER;                       -- Rands per person (NULL/0 = free)
ALTER TABLE events ADD COLUMN requires_pop INTEGER NOT NULL DEFAULT 0;    -- registrants must upload proof of payment
ALTER TABLE events ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;    -- 0 = admin approves each registration
ALTER TABLE events ADD COLUMN payment_instructions TEXT;                  -- banking details; falls back to settings.banking_details

ALTER TABLE event_registrations ADD COLUMN pop_attachment_id TEXT;
ALTER TABLE event_registrations ADD COLUMN amount_due INTEGER;            -- Rands, snapshot at registration
ALTER TABLE event_registrations ADD COLUMN reviewed_at TEXT;
ALTER TABLE event_registrations ADD COLUMN review_note TEXT;
-- registration status now: pending (awaiting approval) | confirmed | waitlist | rejected | cancelled

INSERT OR IGNORE INTO settings (key, value) VALUES ('banking_details', '');
