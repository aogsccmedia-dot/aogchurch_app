// Cookie consent: a calm, on-brand banner with "Accept all", "Essential only" and "Customise".
// Essential = the sign-in cookie (always on). Functional = remembering things on this device
// (join-form drafts, dismissed tips). We run no advertising or tracking cookies.
import { icon } from "./icons.js";
const COOKIE = "scc_consent";
const VERSION = "2026-10";

function read() {
  const m = document.cookie.match(/(?:^|;\s*)scc_consent=([^;]+)/);
  if (!m) return null;
  const [v, f] = decodeURIComponent(m[1]).split("|");
  return v === VERSION ? { functional: f === "1" } : null;
}
export const consentGiven = () => read() !== null;
export const functionalAllowed = () => !!read()?.functional;

function visitorId() {
  try { let id = localStorage.getItem("scc-vid"); if (!id && functionalAllowed()) { id = crypto.randomUUID(); localStorage.setItem("scc-vid", id); } return id || crypto.randomUUID(); }
  catch { return crypto.randomUUID(); }
}

function save(functional) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${encodeURIComponent(`${VERSION}|${functional ? 1 : 0}`)}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${secure}`;
  if (!functional) { try { ["scc-app-tip", "scc-vid"].forEach((k) => localStorage.removeItem(k)); Object.keys(localStorage).filter((k) => k.startsWith("sccy-join")).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } }
  fetch("/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitor_id: visitorId(), functional, version: VERSION }), keepalive: true }).catch(() => {});
  dispatchEvent(new CustomEvent("scc:consent", { detail: { functional } }));
}

let box;
export function openConsent(customise = false) {
  box?.remove();
  const current = read();
  box = document.createElement("section");
  box.className = "consent";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-labelledby", "consent-title");
  box.innerHTML = `<div class="consent-head"><span class="consent-badge" aria-hidden="true">${icon("cookie")}</span><div><b id="consent-title">Your privacy, your choice</b>
      <p>We use one essential cookie to keep you signed in, and (with your OK) your device remembers form drafts and tips you've dismissed. No ads, no tracking. <a href="/cookies">Cookie policy</a></p></div></div>
    <div class="consent-prefs" ${customise ? "" : "hidden"}>
      <label class="consent-row"><span><b>Essential</b><small>Signing in and keeping the site secure. Always on.</small></span><input type="checkbox" checked disabled></label>
      <label class="consent-row"><span><b>Functional</b><small>Remember join-form drafts, your app tip and choices on this device.</small></span><input type="checkbox" data-functional ${current?.functional !== false ? "checked" : ""}></label>
    </div>
    <div class="consent-actions">
      <button type="button" class="btn btn-sm" data-essential>Essential only</button>
      <button type="button" class="btn btn-sm btn-ghost" data-custom ${customise ? "hidden" : ""}>Customise</button>
      <button type="button" class="btn btn-sm" data-save ${customise ? "" : "hidden"}>Save choices</button>
      <button type="button" class="btn btn-gold btn-sm" data-all>Accept all</button>
    </div>`;
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add("show"));
  const done = (functional) => { save(functional); box.classList.remove("show"); setTimeout(() => box?.remove(), 300); };
  box.querySelector("[data-all]").addEventListener("click", () => done(true));
  box.querySelector("[data-essential]").addEventListener("click", () => done(false));
  box.querySelector("[data-save]").addEventListener("click", () => done(box.querySelector("[data-functional]").checked));
  box.querySelector("[data-custom]").addEventListener("click", (e) => {
    box.querySelector(".consent-prefs").hidden = false; e.currentTarget.hidden = true; box.querySelector("[data-save]").hidden = false;
  });
}

document.querySelectorAll("[data-cookie-settings]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); openConsent(true); }));
if (!consentGiven() && !document.body.classList.contains("admin")) setTimeout(() => openConsent(false), 900);
