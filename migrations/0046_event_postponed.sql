-- An event can be postponed: tickets stay valid for the new date, sales close, the old date is hidden and the promo
-- videos move to the event page's archive. postponed_at is set when the church postpones; postponed_note is the line shown on the page.
ALTER TABLE events ADD COLUMN postponed_at TEXT;
ALTER TABLE events ADD COLUMN postponed_note TEXT;

-- Youth Worship Night 2026 (27 Nov) moves to early 2027; the new date will be announced.
UPDATE events SET postponed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  postponed_note = 'Worship Night has been postponed to early 2027. We will announce the new date soon. Your tickets stay valid for the new date. If you would rather have a refund, please email us.',
                  rsvp_enabled = 0,
                  cover_image = '/assets/events/youth-worship-night-2026-postponed-1200.jpg', cover_attachment_id = NULL
 WHERE slug = 'youth-worship-night-2026';
