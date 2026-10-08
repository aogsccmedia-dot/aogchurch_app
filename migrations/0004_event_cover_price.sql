-- Events can use a static cover image (e.g. /assets/events/poster.jpg) and show a ticket price.
ALTER TABLE events ADD COLUMN cover_image TEXT;
ALTER TABLE events ADD COLUMN price_label TEXT;
