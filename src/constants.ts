// Shared option lists. The front-end mirrors these in public/js/options.js.

export const MEMBERSHIP_TYPES = ["new_member", "visitor", "returning", "transfer"] as const;
export const GENDERS = ["male", "female", "prefer_not"] as const;
export const OCCUPATION = ["school", "university", "working", "seeking", "other"] as const;
export const SALVATION = ["saved", "exploring", "not_sure"] as const;
export const YES_NO_WANT = ["yes", "no", "want_to"] as const;
export const HEARD_ABOUT = ["friend", "family", "social_media", "walk_in", "event", "school", "online_search", "other"] as const;

export const MINISTRIES = [
  "youth", "worship", "media", "ushering", "prayer", "evangelism", "creative",
  "hospitality", "kids", "social_media", "sports", "welcome", "events",
] as const;

export const AVAILABILITY = ["sunday_morning", "sunday_evening", "weekday_evening", "saturday", "school_holidays"] as const;

export const MEMBER_STATUSES = ["new", "contacted", "welcomed", "member", "inactive", "revoked"] as const;
export const PRAYER_STATUSES = ["new", "praying", "answered", "archived"] as const;
export const MESSAGE_STATUSES = ["new", "replied", "archived"] as const;
export const EVENT_CATEGORIES = ["service", "night", "camp", "outreach", "conference", "other"] as const;

export const PUBLIC_SETTINGS = [
  "church_name", "youth_name", "tagline", "address", "map_url", "service_summary",
  "contact_email", "whatsapp_number", "instagram_url", "youtube_url", "facebook_url", "tiktok_url",
] as const;

/** Settings only the admin can change (not exposed by /api/settings). */
export const ADMIN_ONLY_SETTINGS = ["banking_details"] as const;
