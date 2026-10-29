-- An event page can rotate several clips after its main promo (played in order, on a loop).
ALTER TABLE events ADD COLUMN video_playlist TEXT;   -- JSON: [{ "src": "/assets/events/<base>", "label": "Name" }]
UPDATE events SET video_playlist = '[{"src":"/assets/events/worship-night-gift","label":"Gift Mofokeng"},{"src":"/assets/events/worship-night-vunene-sinhle","label":"Vunene & Sinhle"},{"src":"/assets/events/worship-night-kagiso","label":"Kagiso Moloto"},{"src":"/assets/events/worship-night-phil","label":"Phil Ndunge"}]'
  WHERE slug = 'youth-worship-night-2026';
