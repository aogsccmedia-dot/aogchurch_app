import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { renderField } from "./forms.js";
import { icon } from "./icons.js";

const slug = new URLSearchParams(location.search).get("e");
const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
const fmtWhen = (s, e) => {
  const d = new Date(s);
  const day = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
  const t = (x) => new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(x);
  return `${day} · ${t(d)}${e ? "–" + t(new Date(e)) : ""}`;
};

let event;
const form = $("reg-form");

function done(status, ref, message, already) {
  form.hidden = true; $("reg-google").hidden = true;
  const wait = status === "waitlist";
  const pendingApproval = status === "pending";
  $("reg-done").hidden = false;
  $("reg-done").innerHTML = `<img class="seal" src="/assets/seal.png" alt="">
    <h3>${already ? (pendingApproval ? "Your payment is being reviewed" : "You're already registered") : wait ? "You're on the waitlist" : pendingApproval ? "Payment received — thank you!" : "You're in! 🎉"}</h3>
    <p class="muted-text">${wait ? "This event is full right now — we'll email you the moment a spot opens." : pendingApproval ? "Our team will check your proof of payment and email your ticket with a calendar invite as soon as it's approved." : "We've emailed your ticket. We can't wait to see you!"}</p>
    ${message ? `<p class="statement">${esc(message)}</p>` : ""}
    <span class="tag">Ref ${esc(ref)}${event.price_label ? " · " + esc(event.price_label) : ""}</span>
    ${wait || pendingApproval ? "" : `<p class="eyebrow" style="margin-top:6px">Add it to your calendar</p>
    <div class="cal-buttons"><a class="btn btn-sm" href="${esc(event.calendar_url)}" target="_blank" rel="noopener">${icon("calendarPlus")} Google</a><a class="btn btn-sm" href="${esc(event.ics_url)}">${icon("download")} Apple / iPhone</a><a class="btn btn-sm" href="${esc(event.outlook_url)}" target="_blank" rel="noopener">${icon("calendarPlus")} Outlook</a></div>`}
    <a class="btn btn-ghost btn-sm" href="/events">${icon("arrowLeft")} More events</a>`;
}

function prefill(me) {
  if (!me?.user) return;
  form.elements.name.value ||= me.user.name || "";
  $("r-email-field").hidden = true;
  form.email.required = false;
  $("reg-heading").textContent = `Hi ${me.user.given_name || "there"} — save your seat`;
  $("reg-google").hidden = true;
}

async function load() {
  if (!slug) { $("ev-title").textContent = "Event not found"; return; }
  let r;
  try {
    r = await api(`/api/events/${encodeURIComponent(slug)}`);
    event = r.event;
  } catch (e) {
    $("ev-title").textContent = "Event not found";
    $("reg-card").innerHTML = `<p class="muted-text">${esc(e.message)}</p><a class="btn" href="/events">See all events</a>`;
    return;
  }
  document.title = `${event.title} · Sandton City Church`;
  addEventSchema(event);
  $("ev-cat").textContent = event.category;
  $("ev-title").textContent = event.title;
  $("ev-when").textContent = fmtWhen(event.starts_at, event.ends_at);
  $("ev-where").textContent = event.location || "17 Humber Street, Woodmead, Sandton";
  $("ev-desc").textContent = event.description || "";
  $("ev-cal").href = event.calendar_url;
  $("ev-ics").href = event.ics_url;
  $("ev-outlook").href = event.outlook_url;
  if (event.price_label) { $("ev-price-row").hidden = false; $("ev-price").textContent = event.price_label; }
  if (event.cover_url) $("ev-cover").innerHTML = `<img src="${esc(event.cover_url)}" alt="${esc(event.title)} poster">`;
  if (event.capacity) { $("ev-cap-row").hidden = false; $("ev-cap").textContent = event.spots_left > 0 ? `${event.spots_left} of ${event.capacity} spots left` : "Fully booked — join the waitlist"; }
  if (!event.collect_phone) { $("r-phone-field").hidden = true; }
  else form.phone.required = true;
  $("custom-fields").innerHTML = event.form.map(renderField).join("");
  setupPayment();

  if (r.mine) { done(r.mine.status, r.mine.ref_code, null, true); return; }
  if (!event.registration_open) {
    $("reg-card").innerHTML = `<p class="eyebrow gold">Registration</p><h3>Registration is closed</h3><p class="muted-text">But you're still very welcome to join us!</p>`;
    return;
  }
  form.hidden = false;
  const me = await getMe();
  if (me.user) prefill(me);
  else await googleButton($("reg-google"), { text: "continue_with" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
  const status = form.querySelector("[data-status]");
  status.hidden = true;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api(`/api/events/${encodeURIComponent(slug)}/register`, { method: "POST", form: new FormData(form) });
    done(r.status, r.ref, r.message, r.already);
  } catch (err) {
    let first;
    for (const [k, msg] of Object.entries(err.details || {})) {
      const field = form.querySelector(`[data-field="${k}"]`) || form.querySelector(`[name="${k}"]`)?.closest(".field");
      if (field) { field.classList.add("invalid"); field.querySelector(".error").textContent = msg; first ??= field; }
    }
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    status.textContent = err.message; status.hidden = false;
  } finally { btn.disabled = false; }
});

$("ev-share").addEventListener("click", async () => {
  const data = { title: event?.title, text: `Join me at ${event?.title}`, url: location.href };
  try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); toast("Link copied"); } } catch { /* cancelled */ }
});

whenSignedIn(async (me) => {
  prefill(me);
  const r = await api(`/api/events/${encodeURIComponent(slug)}`).catch(() => null);
  if (r?.mine) done(r.mine.status, r.mine.ref_code, null, true);
});

document.addEventListener("click", (e) => { const m = document.querySelector(".cal-menu"); if (m && !m.contains(e.target)) m.open = false; });
// ---------- paid events: EFT + proof of payment ----------
const rand = (n) => "R" + Number(n).toLocaleString("en-ZA");
function setupPayment() {
  const price = event.ticket_price;
  const guests = form.guests;
  if (price) {
    $("r-guests-label").textContent = "How many tickets?";
    [...guests.options].forEach((o) => { const n = 1 + Number(o.value); o.textContent = `${n} ${n === 1 ? "ticket (just me)" : "tickets"} · ${rand(price * n)}`; });
  }
  if (!event.requires_pop) return;
  $("pay-block").hidden = false;
  const details = (event.payment_instructions || "").trim();
  if (!details) {
    $("bank-wrap").outerHTML = `<div class="notice">Banking details for this event will be shared here very soon. Please check back shortly.</div>`;
    form.querySelector('[type="submit"]').disabled = true;
    return;
  }
  const rows = details.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l]; });
  const bankRows = rows.filter(([k]) => !/reference/i.test(k));
  const copy = async (text, label) => { try { await navigator.clipboard.writeText(text); toast(`${label} copied`); } catch { toast("Couldn't copy — please copy it manually"); } };
  $("bank-rows").innerHTML = bankRows.map(([k, v], i) => `<div class="bank-row"><dt>${esc(k)}</dt><dd><span>${esc(v)}</span>${k ? `<button type="button" class="icon-btn copy" data-i="${i}" aria-label="Copy ${esc(k)}">${icon("copy")}</button>` : ""}</dd></div>`).join("");
  $("bank-rows").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) { const [k, v] = bankRows[+b.dataset.i]; copy(v.replace(/\s+/g, k.toLowerCase().includes("number") ? "" : " "), k); } });
  const refText = () => form.elements.name.value.trim().replace(/\s+/g, " ");
  const showRef = () => { const r = refText(); $("pay-ref").textContent = r || "Type your full name above"; $("pay-ref").classList.toggle("empty", !r); };
  form.elements.name.addEventListener("input", showRef); showRef();
  $("copy-ref").addEventListener("click", () => { const r = refText(); if (!r) { form.elements.name.focus(); toast("Type your full name first"); return; } copy(r, "Reference"); });
  $("copy-bank").addEventListener("click", () => copy(bankRows.map(([k, v]) => (k ? `${k}: ${v}` : v)).join("\n") + `\nReference: ${refText() || "your full names"}`, "Banking details"));
  const update = () => { $("amount-due").textContent = price ? rand(price * (1 + Number(guests.value || 0))) : "See details above"; };
  guests.addEventListener("change", update); update();
  $("pop").required = true;
  $("pop").addEventListener("change", () => { const f = $("pop").files[0]; $("pop-name").textContent = f ? `✓ ${f.name}` : "Tap to upload a PDF, photo or screenshot"; $("pop").closest(".pop-drop, .field").querySelector(".pop-drop").classList.toggle("has-file", !!f); $("pop").closest(".field").classList.remove("invalid"); });
  $("approval-note").textContent = event.auto_approve ? "Your ticket is emailed straight away." : "You'll get an email straight away saying we've received your details. Once our team has verified your payment, a second email confirms your seat with your ticket and a calendar invite.";
}

load();

// Search engines: describe the event so it can show up in Google's event listings.
function addEventSchema(e) {
  try {
    const url = `${location.origin}/event?e=${encodeURIComponent(e.slug)}`;
    const data = {
      "@context": "https://schema.org", "@type": "Event", name: e.title, description: e.description || undefined,
      startDate: e.starts_at, endDate: e.ends_at || undefined, eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: { "@type": "Place", name: "AOG Sandton City Church", address: { "@type": "PostalAddress", streetAddress: "17 Humber Street", addressLocality: "Woodmead, Sandton", addressRegion: "Gauteng", addressCountry: "ZA" } },
      image: e.cover_url ? [new URL(e.cover_url, location.origin).href] : [`${location.origin}/assets/og.jpg`],
      organizer: { "@type": "Organization", name: "AOG Sandton City Church", url: location.origin },
      offers: { "@type": "Offer", url, price: e.ticket_price || 0, priceCurrency: "ZAR", availability: e.spots_left === 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
    };
    const tag = document.createElement("script"); tag.type = "application/ld+json"; tag.textContent = JSON.stringify(data); document.head.append(tag);
    const canon = document.createElement("link"); canon.rel = "canonical"; canon.href = url; document.head.append(canon);
    document.querySelector('meta[name="description"]')?.setAttribute("content", (e.description || e.title).slice(0, 160));
  } catch { /* never block the page */ }
}
