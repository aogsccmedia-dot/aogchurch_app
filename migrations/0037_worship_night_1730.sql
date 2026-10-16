-- Youth Worship Night now starts at 17:30 (entry and ticket scanning from 17:30), and the poster says 17:30 – 21:00.
-- The time is stored in UTC (17:30 SAST = 15:30 UTC); both stored styles are handled.
UPDATE events SET starts_at = '2026-11-27T15:30:00.000Z'
 WHERE slug = 'youth-worship-night-2026' AND starts_at LIKE '2026-11-27T16:30%';
UPDATE events SET starts_at = '2026-11-27T17:30' || substr(starts_at, 17)
 WHERE slug = 'youth-worship-night-2026' AND starts_at LIKE '2026-11-27T18:30%';
UPDATE events SET description = replace(replace(description, '18:30', '17:30'), '18h30', '17h30'),
                  confirmation_message = replace(replace(confirmation_message, '18:30', '17:30'), '18h30', '17h30')
 WHERE slug = 'youth-worship-night-2026';
-- The new poster (17:30 – 21:00).
UPDATE events SET cover_image = '/assets/events/youth-worship-night-2026-1730-1200.jpg', cover_attachment_id = NULL
 WHERE slug = 'youth-worship-night-2026';
