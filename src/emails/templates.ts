/**
 * Branded, email-client-safe templates (tables + inline styles, no webfonts required).
 * Tone: always warm, personal and encouraging.
 */
export interface Brand { site: string }

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const C = {
  page: "#efe8dc", card: "#fffdf9", ink: "#2b241d", body: "#4a4137", muted: "#8a7f72",
  gold: "#c8963e", goldSoft: "#f3e3c3", night: "#0d0b09", line: "#eadfcd",
};
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
// Playfair Display: open-source high-contrast display serif, closest to Magilio.
// Clients that block web fonts (e.g. Gmail) gracefully fall back to Georgia.
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";

export function button(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px"><tr><td style="border-radius:10px;background:${C.gold}">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${SANS};color:#1a1206;text-decoration:none;border-radius:10px;letter-spacing:.02em">${esc(label)}</a>
  </td></tr></table>`;
}

export function scripture(text: string, ref: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0"><tr>
    <td style="border-left:3px solid ${C.gold};padding:4px 0 4px 18px">
      <p style="margin:0;font:italic 19px/1.5 ${SERIF};color:${C.ink}">“${esc(text)}”</p>
      <p style="margin:8px 0 0;font:600 12px/1 ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.gold}">${esc(ref)}</p>
    </td></tr></table>`;
}

export const p = (html: string) => `<p style="margin:0 0 16px;font:16px/1.7 ${SANS};color:${C.body}">${html}</p>`;
export const paragraphs = (text: string) => text.split(/\n\s*\n/).map((t) => p(esc(t.trim()).replace(/\n/g, "<br>"))).join("");

/** Wrap content in the church layout. */
export function layout(b: Brand, o: { preheader: string; eyebrow?: string; heading: string; content: string; heroImage?: string; footerNote?: string; unsubscribeUrl?: string }): string {
  const hero = o.heroImage ? `<tr><td style="padding:0"><img src="${esc(o.heroImage)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap');</style></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:${C.card};border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(60,40,10,.08)">
    <tr><td align="center" style="background:${C.night};padding:30px 24px 26px">
      <a href="${esc(b.site)}" style="text-decoration:none"><img src="${esc(b.site)}/assets/logo-192.png" width="72" height="72" alt="AOG Sandton City Church" style="display:block;margin:0 auto 14px;border-radius:50%;border:0"></a>
      <p style="margin:0;font:600 11px/1 ${SANS};letter-spacing:.32em;text-transform:uppercase;color:#f6d28b">AOG Sandton City Church</p>
      <p style="margin:8px 0 0;font:italic 13px/1 ${SERIF};color:#b9b0a3">Bound in fellowship by the Spirit</p>
    </td></tr>
    ${hero}
    <tr><td style="padding:38px 40px 14px">
      ${o.eyebrow ? `<p style="margin:0 0 10px;font:600 11px/1 ${SANS};letter-spacing:.24em;text-transform:uppercase;color:${C.gold}">${esc(o.eyebrow)}</p>` : ""}
      <h1 style="margin:0 0 20px;font:400 30px/1.2 ${SERIF};color:${C.ink}">${esc(o.heading)}</h1>
      ${o.content}
    </td></tr>
    <tr><td style="padding:10px 40px 36px">
      <p style="margin:24px 0 0;font:16px/1.6 ${SANS};color:${C.body}">With love,<br><span style="font:italic 18px/1.6 ${SERIF};color:${C.ink}">Your family at Sandton City Church</span></p>
    </td></tr>
    <tr><td style="background:#f8f2e8;border-top:1px solid ${C.line};padding:22px 40px;text-align:center">
      <p style="margin:0 0 6px;font:13px/1.6 ${SANS};color:${C.muted}">17 Humber Street, Woodmead, Sandton</p>
      <p style="margin:0;font:13px/1.6 ${SANS};color:${C.muted}"><a href="${esc(b.site)}" style="color:${C.gold};text-decoration:none">aogsccyouth.com</a>${o.unsubscribeUrl ? ` &nbsp;·&nbsp; <a href="${esc(o.unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe</a>` : ""}</p>
      ${o.footerNote ? `<p style="margin:10px 0 0;font:12px/1.6 ${SANS};color:${C.muted}">${o.footerNote}</p>` : ""}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const textFooter = (b: Brand, unsub?: string) =>
  `\n\nWith love,\nYour family at Sandton City Church\n17 Humber Street, Woodmead, Sandton\n${b.site}${unsub ? `\n\nUnsubscribe: ${unsub}` : ""}`;

// ---------------------------------------------------------------- templates

export function adminCode(b: Brand, code: string) {
  const spaced = code.split("").join(" ");
  return {
    subject: `${code} is your admin sign-in code`,
    html: layout(b, {
      preheader: `Your one-time code is ${code}. It expires in 10 minutes.`,
      eyebrow: "Admin sign-in",
      heading: "Here's your sign-in code",
      content: p("Someone (hopefully you!) is signing in to the church admin dashboard. Enter this code to continue:") +
        `<p style="margin:22px 0;font:600 34px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.24em;color:${C.ink};background:${C.goldSoft};border-radius:12px;padding:20px;text-align:center">${esc(spaced)}</p>` +
        p("The code expires in 10 minutes and can only be used once. If this wasn't you, you can safely ignore this email — nobody can get in without it."),
    }),
    text: `Your admin sign-in code is ${code}. It expires in 10 minutes. If this wasn't you, ignore this email.` + textFooter(b),
  };
}

export function subscribeConfirm(b: Brand, name: string | null, url: string) {
  const hi = name ? `Hi ${esc(name)},` : "Hi there,";
  return {
    subject: "One tap to confirm your weekly letter 💛",
    html: layout(b, {
      preheader: "Confirm your subscription to our weekly announcement letter.",
      eyebrow: "Almost there",
      heading: "Please confirm your subscription",
      content: p(hi) + p("Thank you for wanting to stay close to the family! Every Sunday afternoon we'll send you a short, encouraging letter with the week's services and what's happening at church.") +
        button(url, "Yes, sign me up") + p(`<span style="font-size:13px;color:${C.muted}">If you didn't ask for this, just ignore this email and you won't hear from us.</span>`),
    }),
    text: `${name ? `Hi ${name},` : "Hi there,"}\n\nThank you for wanting to stay close to the family! Please confirm your subscription to our weekly letter:\n${url}\n\nIf you didn't ask for this, ignore this email.` + textFooter(b),
  };
}

export function subscribeWelcome(b: Brand, name: string | null, unsub: string) {
  return {
    subject: "You're in — welcome to the weekly letter",
    html: layout(b, {
      preheader: "Every Sunday afternoon, a little encouragement and the week ahead.",
      eyebrow: "Welcome",
      heading: `${name ? `${esc(name)}, you're` : "You're"} part of the circle`,
      heroImage: `${b.site}/assets/photos/congregation-1200.jpg`,
      content: p("We're so glad you're here. Every Sunday afternoon you'll receive a short letter with the services for the week ahead, upcoming events, and a word to carry with you.") +
        scripture("Let us not give up meeting together, but let us encourage one another.", "Hebrews 10:25") +
        p("Until then, know that you are loved, you are seen, and there's always a seat saved for you at 17 Humber Street.") + button(b.site + "/events", "See what's coming up"),
      unsubscribeUrl: unsub,
    }),
    text: `Welcome! Every Sunday afternoon you'll receive a short letter with the week's services, events and a word to carry with you.\n\n"Let us not give up meeting together, but let us encourage one another." — Hebrews 10:25` + textFooter(b, unsub),
  };
}

export function joinWelcome(b: Brand, name: string, ref: string) {
  return {
    subject: `Welcome to the family, ${name} 💛`,
    html: layout(b, {
      preheader: "We've received your details — a leader will reach out personally this week.",
      eyebrow: "Welcome home",
      heading: `Welcome to the family, ${esc(name)}`,
      heroImage: `${b.site}/assets/photos/hospitality-1200.jpg`,
      content: p("Thank you for taking the step to join AOG Sandton City Church. It genuinely made our day.") +
        p("One of our leaders will reach out to you personally within the week to say hello, answer any questions, and help you find your place. You don't have to have it all figured out — just come as you are.") +
        scripture("So then you are no longer strangers and aliens, but you are fellow citizens with the saints and members of the household of God.", "Ephesians 2:19") +
        p(`Your reference is <strong style="color:${C.ink};letter-spacing:.08em">${esc(ref)}</strong> — keep it handy in case you need it.`) + button(b.site + "/me", "View my profile"),
    }),
    text: `Welcome to the family, ${name}!\n\nThank you for joining AOG Sandton City Church. A leader will reach out personally within the week.\n\nYour reference: ${ref}\n\n"You are no longer strangers... but members of the household of God." — Ephesians 2:19` + textFooter(b),
  };
}

export function adminNewMember(b: Brand, m: { name: string; ref: string; phone: string; email: string; type: string; age: number | null; interests: string }) {
  return {
    subject: `New member sign-up: ${m.name}`,
    html: layout(b, {
      preheader: `${m.name} just joined (${m.type}). Reach out this week!`,
      eyebrow: "New sign-up",
      heading: `${esc(m.name)} just joined`,
      content: `<table role="presentation" cellspacing="0" cellpadding="6" border="0" style="font:15px/1.5 ${SANS};color:${C.body}">
        <tr><td style="color:${C.muted}">Reference</td><td>${esc(m.ref)}</td></tr>
        <tr><td style="color:${C.muted}">Joining as</td><td>${esc(m.type)}</td></tr>
        <tr><td style="color:${C.muted}">Age</td><td>${m.age ?? "—"}</td></tr>
        <tr><td style="color:${C.muted}">Phone</td><td>${esc(m.phone)}</td></tr>
        <tr><td style="color:${C.muted}">Email</td><td>${esc(m.email)}</td></tr>
        <tr><td style="color:${C.muted}">Interests</td><td>${esc(m.interests || "—")}</td></tr></table>` + button(b.site + "/admin/#members", "Open in dashboard"),
    }),
    text: `${m.name} just joined (${m.type}). Ref ${m.ref}. Phone ${m.phone}. Email ${m.email}.\n${b.site}/admin/#members`,
  };
}

export function eventConfirmation(b: Brand, o: { name: string; status: string; ref: string; title: string; when: string; location: string | null; message: string | null;
  calendarUrl: string; eventUrl: string; price?: string | null; cover?: string | null; outlookUrl?: string | null; icsUrl?: string | null; approved?: boolean }) {
  const wait = o.status === "waitlist";
  const ok = !wait && o.approved;
  const cal = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 14px;border-radius:8px;background:#f3ead9;font:600 13px/1 ${SANS};color:${C.ink};text-decoration:none">${esc(label)}</a>`;
  return {
    subject: wait ? `You're on the waitlist for ${o.title}` : ok ? `Congratulations — you're confirmed for ${o.title} 🎉` : `You're registered: ${o.title}`,
    html: layout(b, {
      preheader: wait ? "We'll let you know the moment a spot opens up." : ok ? "Your payment is verified and your seat is confirmed. This email is your ticket." : `See you ${o.when}!`,
      eyebrow: wait ? "Waitlist" : ok ? "Approved · you're in" : "You're in",
      heading: wait ? `You're on the waitlist, ${esc(o.name)}` : ok ? `Congratulations, ${esc(o.name)}!` : `See you there, ${esc(o.name)}!`,
      content: p(wait ? `<strong>${esc(o.title)}</strong> is full right now, but you're on the waitlist and we'll be in touch the moment a spot opens up.` : ok ? `Great news: we've verified your payment and your seat at <strong>${esc(o.title)}</strong> is confirmed. We can't wait to worship with you!` : `You're registered for <strong>${esc(o.title)}</strong>. We can't wait to worship with you.`) +
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 18px;background:${C.goldSoft};border-radius:14px;overflow:hidden"><tr>
          ${o.cover ? `<td width="140" valign="top" style="padding:0"><img src="${esc(o.cover)}" width="140" height="140" alt="" style="display:block;width:140px;height:140px;object-fit:cover;border:0"></td>` : ""}
          <td valign="middle" style="padding:16px 20px;font:15px/1.65 ${SANS};color:${C.ink}">
          <span style="font:500 19px/1.3 ${SERIF};color:${C.ink}">${esc(o.title)}</span><br>${esc(o.when)}${o.location ? `<br>${esc(o.location)}` : ""}
          ${o.price ? `<br><span style="color:${C.gold};font-weight:600">${esc(o.price)}</span>` : ""}<br><span style="color:${C.muted};font-size:13px">Ref ${esc(o.ref)}</span></td></tr></table>` +
        (o.message ? p(esc(o.message)) : "") +
        (wait ? "" : `<p style="margin:18px 0 8px;font:600 11px/1 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${C.gold}">Add it to your calendar</p>
          <p style="margin:0 0 6px">${cal(o.calendarUrl, "Google")}${o.icsUrl ? cal(o.icsUrl, "Apple / iPhone") : ""}${o.outlookUrl ? cal(o.outlookUrl, "Outlook") : ""}</p>
          <p style="margin:0 0 16px;font:13px/1.6 ${SANS};color:${C.muted}">A calendar invite (.ics) is also attached to this email.</p>`) +
        button(o.eventUrl, "View event details"),
    }),
    text: `${wait ? "You're on the waitlist for" : ok ? "Congratulations! Your payment is verified and you're confirmed for" : "You're registered for"} ${o.title}\n${o.when}${o.location ? `\n${o.location}` : ""}${o.price ? `\n${o.price}` : ""}\nRef ${o.ref}\n${o.message || ""}\nAdd to Google Calendar: ${o.calendarUrl}\n${o.eventUrl}` + textFooter(b),
  };
}

function eventBox(o: { title: string; when: string; location: string | null; ref: string; cover?: string | null; extra?: string }) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 18px;background:${C.goldSoft};border-radius:14px;overflow:hidden"><tr>
    ${o.cover ? `<td width="120" valign="top" style="padding:0"><img src="${esc(o.cover)}" width="120" height="120" alt="" style="display:block;width:120px;height:120px;object-fit:cover;border:0"></td>` : ""}
    <td valign="middle" style="padding:16px 20px;font:15px/1.65 ${SANS};color:${C.ink}">
    <span style="font:500 18px/1.3 ${SERIF};color:${C.ink}">${esc(o.title)}</span><br>${esc(o.when)}${o.location ? `<br>${esc(o.location)}` : ""}
    ${o.extra || ""}<br><span style="color:${C.muted};font-size:13px">Ref ${esc(o.ref)}</span></td></tr></table>`;
}

export function eventPending(b: Brand, o: { name: string; ref: string; title: string; when: string; location: string | null; eventUrl: string; cover?: string | null; amount: string; people: number }) {
  return {
    subject: `We've received your details — ${o.title}`,
    html: layout(b, {
      preheader: "We've got your registration and proof of payment. We're verifying it now.",
      eyebrow: "Received · being verified",
      heading: `Thank you, ${esc(o.name)}!`,
      content: p(`We've received your registration and proof of payment for <strong>${esc(o.title)}</strong>, and our team is verifying it now. This usually takes a day or two.`) +
        eventBox({ ...o, extra: o.amount ? `<br><span style="color:${C.gold};font-weight:600">${esc(o.amount)} · ${o.people} ${o.people === 1 ? "person" : "people"}</span>` : "" }) +
        p("As soon as it's approved we'll send you a second email confirming your seat, with your ticket and a calendar invite. You don't need to do anything else.") +
        button(o.eventUrl, "View event"),
    }),
    text: `Thank you, ${o.name}! We've received your registration and proof of payment for ${o.title} (${o.when}) and we're verifying it now. Ref ${o.ref}. Once it's approved we'll email you to confirm your seat.` + textFooter(b),
  };
}

export function eventDeclined(b: Brand, o: { name: string; ref: string; title: string; when: string; location: string | null; eventUrl: string; cover?: string | null; note: string | null }) {
  return {
    subject: `About your registration for ${o.title}`,
    html: layout(b, {
      preheader: "We couldn't confirm your payment yet — here's what to do next.",
      eyebrow: "Registration update",
      heading: `Hi ${esc(o.name)}, a quick update`,
      content: p(`We weren't able to confirm the proof of payment for your registration to <strong>${esc(o.title)}</strong>.`) +
        (o.note ? `<p style="margin:0 0 16px;padding:14px 16px;border-left:3px solid ${C.gold};background:#faf4ea;font:15px/1.6 ${SANS};color:${C.ink}">${esc(o.note)}</p>` : "") +
        eventBox(o) +
        p("No stress — simply reply to this email and we'll sort it out together, or register again with the correct proof of payment. We'd love to see you there.") +
        button(o.eventUrl, "Register again"),
    }),
    text: `Hi ${o.name}, we weren't able to confirm the proof of payment for ${o.title}.${o.note ? `\n${o.note}` : ""}\nReply to this email and we'll help. ${o.eventUrl}` + textFooter(b),
  };
}

export function prayerReceived(b: Brand, name: string) {
  return {
    subject: "We're praying with you",
    html: layout(b, {
      preheader: "Your prayer request reached us. You're not alone.",
      eyebrow: "Prayer",
      heading: `${esc(name)}, we're standing with you`,
      heroImage: `${b.site}/assets/photos/prayer-1200.jpg`,
      content: p("Thank you for trusting us with what's on your heart. Your request has reached our prayer team, and we're bringing it before the Lord.") +
        scripture("Cast all your anxiety on him because he cares for you.", "1 Peter 5:7") +
        p("Whatever you're facing, you don't face it alone. If you asked us to reach out, someone will be in touch soon."),
    }),
    text: `${name}, thank you for trusting us with what's on your heart. Our prayer team is praying with you.\n\n"Cast all your anxiety on him because he cares for you." — 1 Peter 5:7` + textFooter(b),
  };
}

export function contactReceived(b: Brand, name: string) {
  return {
    subject: "Thanks for reaching out 💛",
    html: layout(b, {
      preheader: "We've got your message and will reply soon.",
      eyebrow: "Message received",
      heading: `Thank you, ${esc(name)}`,
      content: p("We've received your message and someone from the church will get back to you soon. We're really glad you got in touch.") + button(b.site, "Visit our website"),
    }),
    text: `Thank you, ${name}! We've received your message and will get back to you soon.` + textFooter(b),
  };
}

export interface AnnouncementData {
  subject: string; preheader: string | null; heading: string; body: string;
  scripture_text: string | null; scripture_ref: string | null;
  services: { title: string; when: string; location?: string; note?: string }[];
  events: { title: string; when: string; location: string | null; url: string }[];
  cta_label: string | null; cta_url: string | null;
}

export function announcement(b: Brand, a: AnnouncementData, firstName: string | null, unsub: string) {
  const row = (title: string, when: string, loc?: string | null, note?: string | null, url?: string) =>
    `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.line}">
      <p style="margin:0;font:600 16px/1.4 ${SANS};color:${C.ink}">${url ? `<a href="${esc(url)}" style="color:${C.ink};text-decoration:none">${esc(title)}</a>` : esc(title)}</p>
      <p style="margin:4px 0 0;font:14px/1.5 ${SANS};color:${C.gold}">${esc(when)}</p>
      ${loc ? `<p style="margin:2px 0 0;font:14px/1.5 ${SANS};color:${C.muted}">${esc(loc)}</p>` : ""}
      ${note ? `<p style="margin:6px 0 0;font:14px/1.6 ${SANS};color:${C.body}">${esc(note)}</p>` : ""}</td></tr>`;
  const items = [
    ...a.services.map((s) => row(s.title, s.when, s.location, s.note)),
    ...a.events.map((e) => row(e.title, e.when, e.location, null, e.url)),
  ];
  const schedule = items.length ? `<p style="margin:30px 0 4px;font:600 11px/1 ${SANS};letter-spacing:.24em;text-transform:uppercase;color:${C.gold}">This week at church</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${items.join("")}</table>` : "";
  const greeting = p(firstName ? `Dear ${esc(firstName)},` : "Dear friend,");
  return {
    subject: a.subject,
    html: layout(b, {
      preheader: a.preheader || "This week's services and a word of encouragement.",
      eyebrow: "The weekly letter",
      heading: a.heading,
      heroImage: `${b.site}/assets/photos/worship-1200.jpg`,
      content: greeting + paragraphs(a.body) + (a.scripture_text ? scripture(a.scripture_text, a.scripture_ref || "") : "") + schedule +
        (a.cta_url && a.cta_label ? button(a.cta_url, a.cta_label) : button(b.site + "/events", "See all services & events")),
      unsubscribeUrl: unsub,
      footerNote: "You're receiving this because you signed up for our weekly announcement letter.",
    }),
    text: `${firstName ? `Dear ${firstName},` : "Dear friend,"}\n\n${a.body}\n\n${a.scripture_text ? `"${a.scripture_text}" — ${a.scripture_ref || ""}\n\n` : ""}` +
      (items.length ? "THIS WEEK AT CHURCH\n" + [...a.services.map((s) => `• ${s.title} — ${s.when}${s.location ? ` — ${s.location}` : ""}`), ...a.events.map((e) => `• ${e.title} — ${e.when} — ${e.url}`)].join("\n") : "") +
      textFooter(b, unsub),
  };
}

export function adminPaymentToReview(b: Brand, o: { name: string; title: string; ref: string; amount: string; eventId: string }) {
  return {
    subject: `Payment to approve: ${o.name} · ${o.title}`,
    html: layout(b, {
      preheader: `${o.name} uploaded proof of payment${o.amount ? ` (${o.amount})` : ""}.`,
      eyebrow: "Payment to review",
      heading: `${esc(o.name)} is waiting for approval`,
      content: p(`${esc(o.name)} registered for <strong>${esc(o.title)}</strong> and uploaded proof of payment${o.amount ? ` for <strong>${esc(o.amount)}</strong>` : ""}. Ref ${esc(o.ref)}.`) +
        button(`${b.site}/admin/#event:${o.eventId}`, "Review & approve"),
    }),
    text: `${o.name} registered for ${o.title} and uploaded proof of payment${o.amount ? ` (${o.amount})` : ""}. Ref ${o.ref}. Review: ${b.site}/admin/#event:${o.eventId}`,
  };
}

export function adminLetterReminder(b: Brand) {
  return {
    subject: "Reminder: this Sunday's letter isn't scheduled yet",
    html: layout(b, {
      preheader: "Schedule the weekly announcement letter before Sunday afternoon.",
      eyebrow: "Gentle reminder",
      heading: "Your Sunday letter is waiting",
      content: p("There's no announcement letter scheduled for this Sunday yet. It only takes a few minutes — add the week's services and a word of encouragement, and it'll go out automatically on Sunday afternoon.") +
        button(b.site + "/admin/#letters", "Write this week's letter"),
    }),
    text: `There's no announcement letter scheduled for this Sunday yet. ${b.site}/admin/#letters`,
  };
}

// ---------- membership check-ins ----------
const since = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });

function twoButtons(yes: { href: string; label: string }, no: { href: string; label: string }) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px"><tr>
    <td style="border-radius:10px;background:${C.gold}"><a href="${esc(yes.href)}" style="display:inline-block;padding:14px 24px;font:600 15px/1 ${SANS};color:#1a1206;text-decoration:none;border-radius:10px">${esc(yes.label)}</a></td>
    <td width="12"></td>
    <td style="border-radius:10px;border:1px solid ${C.line};background:#ffffff"><a href="${esc(no.href)}" style="display:inline-block;padding:13px 20px;font:600 14px/1 ${SANS};color:${C.body};text-decoration:none;border-radius:10px">${esc(no.label)}</a></td>
  </tr></table>`;
}

export function membershipCheckin(b: Brand, o: { name: string; ref: string; since: string; stayUrl: string; revokeUrl: string; reminder?: boolean }) {
  return {
    subject: o.reminder ? `${o.name}, a quick reminder: are you still part of the family?` : `${o.name}, are you still part of the family? 💛`,
    html: layout(b, {
      preheader: "One tap to confirm your membership at AOG Sandton City Church.",
      eyebrow: o.reminder ? "Gentle reminder" : "Membership check-in",
      heading: `Still with us, ${esc(o.name)}?`,
      heroImage: `${b.site}/assets/photos/congregation-1200.jpg`,
      content: p(`You've been part of AOG Sandton City Church since ${esc(since(o.since))}, and we're so grateful for you. Every few months we check in, so our family list stays current and our leaders can care for you well.`) +
        p("Please let us know with one tap:") +
        twoButtons({ href: o.stayUrl, label: "Yes, I'm still a member" }, { href: o.revokeUrl, label: "Revoke my membership" }) +
        p(`<span style="font-size:13px;color:${C.muted}">If life has moved you on, that's okay. Revoking simply removes you from our member list, and you're always welcome back. Your reference is ${esc(o.ref)}.</span>`) +
        scripture("I thank my God every time I remember you.", "Philippians 1:3"),
    }),
    text: `Hi ${o.name},\n\nAre you still part of AOG Sandton City Church?\n\nYes, I'm still a member: ${o.stayUrl}\nRevoke my membership: ${o.revokeUrl}\n\nReference ${o.ref}.` + textFooter(b),
  };
}

export function membershipRevoked(b: Brand, o: { name: string }) {
  return {
    subject: "Your membership has been revoked",
    html: layout(b, {
      preheader: "Thank you for being part of the family. You're always welcome back.",
      eyebrow: "Membership",
      heading: `Thank you, ${esc(o.name)}`,
      content: p("As you asked, we've revoked your membership and removed you from our member check-ins. Thank you for every Sunday, every prayer and every moment you shared with us.") +
        p("You're always welcome at 17 Humber Street, and if you'd like to come back, rejoining takes a few minutes.") +
        scripture("The Lord bless you and keep you; the Lord make his face shine on you.", "Numbers 6:24–25") +
        button(b.site + "/join", "Rejoin anytime") +
        p(`<span style="font-size:13px;color:${C.muted}">This doesn't change the weekly letter. You can manage that from any letter or your profile. Didn't ask for this? Simply reply to this email and we'll restore it.</span>`),
    }),
    text: `Thank you, ${o.name}. As you asked, we've revoked your membership. You're always welcome back: ${b.site}/join` + textFooter(b),
  };
}

export function adminMemberRevoked(b: Brand, o: { name: string; ref: string; reason: string | null; via: string }) {
  return {
    subject: `Membership revoked: ${o.name}`,
    html: layout(b, {
      preheader: `${o.name} revoked their membership (${o.via}).`,
      eyebrow: "Member update",
      heading: `${esc(o.name)} revoked their membership`,
      content: p(`Reference <strong>${esc(o.ref)}</strong>, via ${esc(o.via)}.`) +
        (o.reason ? `<p style="margin:0 0 16px;padding:14px 16px;border-left:3px solid ${C.gold};background:#faf4ea;font:15px/1.6 ${SANS};color:${C.ink}">“${esc(o.reason)}”</p>` : "") +
        p("A short, kind follow-up from a leader can mean a lot.") + button(b.site + "/admin/#members", "Open members"),
    }),
    text: `${o.name} (${o.ref}) revoked their membership via ${o.via}.${o.reason ? ` Reason: ${o.reason}` : ""}`,
  };
}

// ---------- complaints ----------
const COMPLAINT_STATUS_LABEL: Record<string, string> = { received: "Received", in_review: "Being looked into", resolved: "Resolved", closed: "Closed" };

export function complaintReceived(b: Brand, o: { name: string; ref: string; subject: string }) {
  return {
    subject: `We've received your complaint (${o.ref})`,
    html: layout(b, {
      preheader: "Thank you for telling us. A leader will respond within 7 working days.",
      eyebrow: "Complaint received",
      heading: `Thank you, ${esc(o.name)}`,
      content: p(`We've received your complaint “<strong>${esc(o.subject)}</strong>”. Thank you for trusting us with it. Raising a concern takes courage, and we take it seriously.`) +
        p("A leader will review it and respond within <strong>7 working days</strong>. You can follow its progress on your profile at any time.") +
        p(`Your reference is <strong style="letter-spacing:.06em">${esc(o.ref)}</strong>.`) + button(b.site + "/me#complaints", "View my complaints"),
    }),
    text: `Thank you, ${o.name}. We've received your complaint "${o.subject}" (${o.ref}). A leader will respond within 7 working days. ${b.site}/me#complaints` + textFooter(b),
  };
}

export function complaintUpdate(b: Brand, o: { name: string; ref: string; subject: string; status: string; response: string | null }) {
  return {
    subject: `Update on your complaint (${o.ref}): ${COMPLAINT_STATUS_LABEL[o.status] || o.status}`,
    html: layout(b, {
      preheader: `Your complaint is now: ${COMPLAINT_STATUS_LABEL[o.status] || o.status}.`,
      eyebrow: "Complaint update",
      heading: `Hi ${esc(o.name)}, an update for you`,
      content: p(`Your complaint “<strong>${esc(o.subject)}</strong>” (${esc(o.ref)}) is now <strong>${esc(COMPLAINT_STATUS_LABEL[o.status] || o.status)}</strong>.`) +
        (o.response ? `<p style="margin:0 0 16px;padding:14px 16px;border-left:3px solid ${C.gold};background:#faf4ea;font:15px/1.65 ${SANS};color:${C.ink}">${esc(o.response).replace(/\n/g, "<br>")}</p>` : "") +
        p("If you'd like to talk about it further, simply reply to this email.") + button(b.site + "/me#complaints", "View my complaints"),
    }),
    text: `Your complaint "${o.subject}" (${o.ref}) is now ${COMPLAINT_STATUS_LABEL[o.status] || o.status}.${o.response ? `\n\n${o.response}` : ""}\n${b.site}/me#complaints` + textFooter(b),
  };
}

export function adminNewComplaint(b: Brand, o: { name: string; ref: string; category: string; subject: string; confidential: boolean }) {
  return {
    subject: `New complaint ${o.ref}: ${o.subject}`,
    html: layout(b, {
      preheader: `${o.name} raised a ${o.category} complaint. Please respond within 7 working days.`,
      eyebrow: "New complaint",
      heading: `${esc(o.name)} raised a complaint`,
      content: p(`<strong>${esc(o.subject)}</strong><br>Category: ${esc(o.category)}${o.confidential ? " · <strong>Confidential: pastors only</strong>" : ""}<br>Reference: ${esc(o.ref)}`) +
        p("Please acknowledge and respond within 7 working days.") + button(b.site + "/admin/#complaints", "Open complaints"),
    }),
    text: `New complaint ${o.ref} from ${o.name}: ${o.subject} (${o.category}). ${b.site}/admin/#complaints`,
  };
}
