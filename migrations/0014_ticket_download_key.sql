-- Private download key per booking, so the ticket holder can download their PDF tickets straight from the email.
ALTER TABLE event_registrations ADD COLUMN ticket_key TEXT;
