-- Events can have a promo video (plays by itself on the landing page, members' Home and the event page).
-- Stored as a base path: <base>-1080.mp4, <base>-720.mp4 and <base>-poster.jpg.
ALTER TABLE events ADD COLUMN cover_video TEXT;
UPDATE events SET cover_video = '/assets/events/worship-night-promo' WHERE slug = 'youth-worship-night-2026';
