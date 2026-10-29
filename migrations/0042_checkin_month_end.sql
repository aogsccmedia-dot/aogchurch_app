-- First membership check-in: four calendar months after joining, staying inside that month.
-- SQLite's '+4 months' overflows (29–31 October became 1–3 March); this keeps it to the end of February.
DROP TRIGGER IF EXISTS trg_members_first_checkin;
CREATE TRIGGER IF NOT EXISTS trg_members_first_checkin AFTER INSERT ON members
WHEN NEW.next_checkin_at IS NULL
BEGIN
  UPDATE members SET next_checkin_at =
    min(date(NEW.created_at, 'start of month', '+4 months', '+' || (CAST(strftime('%d', NEW.created_at) AS INTEGER) - 1) || ' days'),
        date(NEW.created_at, 'start of month', '+5 months', '-1 day'))
    || 'T' || strftime('%H:%M:%fZ', NEW.created_at)
  WHERE id = NEW.id;
END;
