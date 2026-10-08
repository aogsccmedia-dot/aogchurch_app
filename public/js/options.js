// Mirrors src/constants.ts — keep slugs in sync.
import { icon } from "./icons.js";
const I = (name) => icon(name, "ico");

export const MINISTRIES = [
  { slug: "youth", label: "Youth ministry", desc: "High-schoolers, students and young professionals growing together.", icon: I("sparkles") },
  { slug: "worship", label: "Worship team", desc: "Vocals, keys, guitar, drums — lead the room into God's presence.", icon: I("music") },
  { slug: "media", label: "Media & tech", desc: "Cameras, sound, lights, livestream and projection.", icon: I("video") },
  { slug: "social_media", label: "Content & socials", desc: "Design, photography, reels and storytelling online.", icon: I("instagram") },
  { slug: "prayer", label: "Prayer team", desc: "Intercede for our church, families and city.", icon: I("flame") },
  { slug: "ushering", label: "Ushering & protocol", desc: "Welcome people, keep order and serve on Sundays.", icon: I("userCheck") },
  { slug: "welcome", label: "Welcome & follow-up", desc: "Be the first friendly face for new people.", icon: I("smile") },
  { slug: "evangelism", label: "Outreach & evangelism", desc: "Take the gospel to campuses, streets and communities.", icon: I("globe") },
  { slug: "creative", label: "Creative arts", desc: "Drama, dance, spoken word and visual art.", icon: I("palette") },
  { slug: "hospitality", label: "Hospitality & events", desc: "Food, coffee, setup and camps — make everyone feel at home.", icon: I("coffee") },
  { slug: "kids", label: "Kids church", desc: "Help teach and care for the little ones.", icon: I("baby") },
  { slug: "sports", label: "Sports & fitness", desc: "Games days, soccer, netball and fun runs.", icon: I("trophy") },
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
