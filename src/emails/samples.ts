/**
 * Every email the website sends, rendered with sample data, so the admin can preview each one
 * and send a test to themselves from the dashboard (Admin → Email templates).
 */
import * as T from "./templates.ts";

export interface Sample { key: string; group: "Events" | "Weekly letter" | "Welcome" | "Care" | "Admin"; when: string; render: (site: string) => { subject: string; html: string; text: string } }

const ev = (site: string) => ({
  name: "Thandi", ref: "SCC-7Q4K", title: "Youth Worship Night", when: "Friday 27 November 2026 · 18:30 – 21:00",
  location: "17 Humber Street, Woodmead, Sandton", eventUrl: `${site}/event?e=youth-worship-night-2026`, cover: `${site}/assets/photos/worship-1200.jpg`,
});

export const SAMPLES: Sample[] = [
  { key: "event_pending", group: "Events", when: "Someone registers for a paid event and uploads proof of payment — “we've received your details and are verifying them”.",
    render: (s) => T.eventPending({ site: s }, { ...ev(s), amount: "R300", people: 2 }) },
  { key: "event_approved", group: "Events", when: "You approve their payment — “Congratulations, you're confirmed”, with ticket and calendar invite.",
    render: (s) => T.eventConfirmation({ site: s }, { ...ev(s), status: "confirmed", approved: true, price: "R150 per person", message: null,
      calendarUrl: "https://calendar.google.com", outlookUrl: "https://outlook.live.com", icsUrl: `${s}/api/events/youth-worship-night-2026/calendar.ics` }) },
  { key: "event_confirmation", group: "Events", when: "Someone registers for a free event (confirmed straight away).",
    render: (s) => T.eventConfirmation({ site: s }, { ...ev(s), status: "confirmed", price: null, message: "Doors open at 18:00. Bring a friend!",
      calendarUrl: "https://calendar.google.com", outlookUrl: "https://outlook.live.com", icsUrl: `${s}/api/events/youth-worship-night-2026/calendar.ics` }) },
  { key: "event_waitlist", group: "Events", when: "The event is full and they join the waitlist.",
    render: (s) => T.eventConfirmation({ site: s }, { ...ev(s), status: "waitlist", price: null, message: null, calendarUrl: "#" }) },
  { key: "event_declined", group: "Events", when: "You decline a proof of payment (with your optional note).",
    render: (s) => T.eventDeclined({ site: s }, { ...ev(s), note: "The reference on the payment didn't match a registration. Please reply with your proof of payment." }) },
  { key: "subscribe_confirm", group: "Weekly letter", when: "Someone signs up for the weekly letter with their email (one-tap confirm).",
    render: (s) => T.subscribeConfirm({ site: s }, "Thandi", `${s}/api/newsletter/confirm?t=sample`) },
  { key: "subscribe_welcome", group: "Weekly letter", when: "They confirm (or sign up with Google) — the weekly letter welcome.",
    render: (s) => T.subscribeWelcome({ site: s }, "Thandi", `${s}/api/newsletter/unsubscribe?t=sample`) },
  { key: "announcement", group: "Weekly letter", when: "The Sunday letter you write in Admin → Weekly letter (sample content).",
    render: (s) => T.announcement({ site: s }, {
      subject: "This week at church", preheader: "Services, events and a word for the week", heading: "A week to remember",
      body: "Dear family, what a joy it was to worship together this morning.\n\nThis week we're gathering for prayer on Wednesday and our youth are hosting Worship Night on Friday. Bring a friend!",
      scripture_text: "This is the day the Lord has made; let us rejoice and be glad in it.", scripture_ref: "Psalm 118:24",
      services: [{ title: "Sunday service", when: "Sunday · 09:30", location: "17 Humber Street" }, { title: "Prayer & Bible study", when: "Wednesday · 18:30" }],
      events: [{ title: "Youth Worship Night", when: "Fri 27 Nov · 18:30", location: "17 Humber Street", url: `${s}/event?e=youth-worship-night-2026` }],
      cta_label: null, cta_url: null }, "Thandi", `${s}/api/newsletter/unsubscribe?t=sample`) },
  { key: "member_verified", group: "Welcome", when: "You set a member's status to “member” (verified): the animated welcome.",
    render: (s) => T.memberVerified({ site: s }, { name: "Thandi", ref: "SCC-2M8D" }) },
  { key: "membership_checkin", group: "Welcome", when: "Every 4 months after joining: “Still a member?” with Yes / Revoke buttons (one reminder after 14 days).",
    render: (s) => T.membershipCheckin({ site: s }, { name: "Thandi", ref: "SCC-2M8D", since: "2026-06-07T09:00:00Z", stayUrl: `${s}/membership?t=sample&a=stay`, revokeUrl: `${s}/membership?t=sample&a=revoke` }) },
  { key: "membership_revoked", group: "Welcome", when: "A member revokes their membership (from the email or their profile).",
    render: (s) => T.membershipRevoked({ site: s }, { name: "Thandi" }) },
  { key: "join_welcome", group: "Welcome", when: "Someone completes the Join the church form.",
    render: (s) => T.joinWelcome({ site: s }, "Thandi", "SCC-2M8D") },
  { key: "prayer_received", group: "Care", when: "Someone sends a prayer request and leaves an email.",
    render: (s) => T.prayerReceived({ site: s }, "Thandi") },
  { key: "contact_received", group: "Care", when: "Someone sends a message from the Visit & contact page.",
    render: (s) => T.contactReceived({ site: s }, "Thandi") },
  { key: "complaint_received", group: "Care", when: "An approved member raises a complaint from their profile.",
    render: (s) => T.complaintReceived({ site: s }, { name: "Thandi", ref: "CMP-7KQ2", subject: "Parking marshals at the 09:30 service" }) },
  { key: "complaint_update", group: "Care", when: "You update a complaint's status or reply to it in Admin → Complaints.",
    render: (s) => T.complaintUpdate({ site: s }, { name: "Thandi", ref: "CMP-7KQ2", subject: "Parking marshals at the 09:30 service", status: "resolved", response: "Thank you for raising this. From this Sunday we have two extra marshals at the gate, and a leader will call you this week." }) },
  { key: "admin_new_complaint", group: "Admin", when: "Sent to you when a member raises a complaint.",
    render: (s) => T.adminNewComplaint({ site: s }, { name: "Thandi Mokoena", ref: "CMP-7KQ2", category: "facilities", subject: "Parking marshals at the 09:30 service", confidential: false }) },
  { key: "admin_payment_review", group: "Admin", when: "Sent to you when a payment is waiting for approval.",
    render: (s) => T.adminPaymentToReview({ site: s }, { name: "Thandi Mokoena", title: "Youth Worship Night", ref: "SCC-7Q4K", amount: "R300", eventId: "sample" }) },
  { key: "admin_new_member", group: "Admin", when: "Sent to you when someone joins the church.",
    render: (s) => T.adminNewMember({ site: s }, { name: "Thandi Mokoena", ref: "SCC-2M8D", phone: "+27 82 123 4567", email: "thandi@example.com", type: "New member", age: 24, interests: "Worship, Media" }) },
  { key: "admin_member_revoked", group: "Admin", when: "Sent to you when a member revokes their membership.",
    render: (s) => T.adminMemberRevoked({ site: s }, { name: "Thandi Mokoena", ref: "SCC-2M8D", reason: "We've moved to Durban.", via: "email check-in" }) },
  { key: "admin_granted", group: "Admin", when: "You give a member admin access in Admin → Team & roles.",
    render: (s) => T.adminGranted({ site: s }, { name: "Thandi" }) },
  { key: "admin_letter_reminder", group: "Admin", when: "Saturday morning, if no letter is scheduled for Sunday.",
    render: (s) => T.adminLetterReminder({ site: s }) },
  { key: "admin_code", group: "Admin", when: "Your 6-digit admin sign-in code.",
    render: (s) => T.adminCode({ site: s }, "482913") },
];
