-- Ticket money targets per event (Rands), seen only by admins and verified pastors, with a weekly progress email to them.
ALTER TABLE events ADD COLUMN ticket_target INTEGER;
UPDATE events SET ticket_target = 80000 WHERE id = 'evt-youth-worship-night-2026';
