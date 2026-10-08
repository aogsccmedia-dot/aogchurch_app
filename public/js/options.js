// Mirrors src/constants.ts — keep slugs in sync.
const I = (d) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const MINISTRIES = [
  { slug: "youth", label: "Youth ministry", desc: "High-schoolers, students and young professionals growing together.", icon: I('<path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.3 7.2 16.9l.9-5.4L4.2 7.7l5.4-.8z"/>') },
  { slug: "worship", label: "Worship team", desc: "Vocals, keys, guitar, drums — lead the room into God's presence.", icon: I('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>') },
  { slug: "media", label: "Media & tech", desc: "Cameras, sound, lights, livestream and projection.", icon: I('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>') },
  { slug: "social_media", label: "Content & socials", desc: "Design, photography, reels and storytelling online.", icon: I('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>') },
  { slug: "prayer", label: "Prayer team", desc: "Intercede for our church, families and city.", icon: I('<path d="M12 3c1.5 3 4 4 4 8a4 4 0 0 1-8 0c0-4 2.5-5 4-8z"/><path d="M8 21h8"/>') },
  { slug: "ushering", label: "Ushering & protocol", desc: "Welcome people, keep order and serve on Sundays.", icon: I('<path d="M3 21v-2a4 4 0 0 1 4-4h4"/><circle cx="9" cy="7" r="4"/><path d="M16 19l2 2 4-4"/>') },
  { slug: "welcome", label: "Welcome & follow-up", desc: "Be the first friendly face for new people.", icon: I('<path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M5 11h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/>') },
  { slug: "evangelism", label: "Outreach & evangelism", desc: "Take the gospel to campuses, streets and communities.", icon: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') },
  { slug: "creative", label: "Creative arts", desc: "Drama, dance, spoken word and visual art.", icon: I('<path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><circle cx="11" cy="11" r="2"/>') },
  { slug: "hospitality", label: "Hospitality & events", desc: "Food, coffee, setup and camps — make everyone feel at home.", icon: I('<path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v3M10 2v3M14 2v3"/>') },
  { slug: "kids", label: "Kids church", desc: "Help teach and care for the little ones.", icon: I('<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>') },
  { slug: "sports", label: "Sports & fitness", desc: "Games days, soccer, netball and fun runs.", icon: I('<circle cx="12" cy="12" r="9"/><path d="M12 3l3 6-3 3-3-3zM3.5 9.5L9 9M20.5 9.5L15 9M12 12v5l-4 3M12 17l4 3"/>') },
];

export const AVAILABILITY = [
  ["sunday_morning", "Sunday mornings"], ["sunday_evening", "Sunday evenings"],
  ["weekday_evening", "Weekday evenings"], ["saturday", "Saturdays"], ["school_holidays", "School holidays"],
];

export const LABELS = {
  membership_type: { new_member: "New — I want to become a member", visitor: "Visiting / want to connect", returning: "Returning to church", transfer: "Transferring from another church" },
  gender: { male: "Male", female: "Female", prefer_not: "Prefer not to say" },
  occupation_status: { school: "At school", university: "University / college", working: "Working", seeking: "Looking for work", other: "Other" },
  salvation_status: { saved: "Yes, I've given my life to Jesus", exploring: "I'm exploring faith", not_sure: "I'm not sure yet" },
  yes_no_want: { yes: "Yes", no: "Not yet", want_to: "No, but I'd like to be" },
  heard_about: { friend: "A friend", family: "Family", social_media: "Social media", walk_in: "Walked in", event: "An event", school: "School / campus", online_search: "Online search", other: "Other" },
};
