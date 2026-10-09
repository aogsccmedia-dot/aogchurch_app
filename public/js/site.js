// Always start a fresh load or refresh at the top of the page (unless the link points to a section).
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
if (!location.hash) scrollTo(0, 0);

// Shared behaviour for every public page: header, menu, reveal animations,
// settings, toasts and a tiny API helper.

export async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw Object.assign(new Error("You seem to be offline. Please check your connection and try again."), { status: 0 }); }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, details: data.details });
  }
  return data;
}

export function toast(msg, ms = 3200) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let settingsPromise;
export function getSettings() {
  settingsPromise ??= api("/api/settings").then((d) => d.settings).catch(() => ({}));
  return settingsPromise;
}

function initHeader() {
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }
  const menu = document.querySelector(".menu");
  const openBtn = document.querySelector("[data-menu-open]");
  const closeBtn = document.querySelector("[data-menu-close]");
  if (!menu || !openBtn) return;
  const setOpen = (open) => {
    menu.classList.toggle("open", open);
    menu.setAttribute("aria-hidden", String(!open));
    openBtn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
    if (open) closeBtn?.focus(); else if (document.activeElement?.closest?.(".menu")) openBtn.focus();
  };
  openBtn.addEventListener("click", () => setOpen(true));
  document.querySelector("[data-menu-open-tab]")?.addEventListener("click", () => setOpen(true));
  closeBtn?.addEventListener("click", () => setOpen(false));
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.classList.contains("open")) setOpen(false); });
}

function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}

async function fillSettings() {
  const s = await getSettings();
  document.querySelectorAll("[data-setting]").forEach((el) => {
    const v = s[el.dataset.setting];
    if (!v) { if (el.dataset.hideEmpty !== undefined) el.hidden = true; return; }
    if (el.tagName === "A") {
      const key = el.dataset.setting;
      if (key === "contact_email") el.href = `mailto:${v}`;
      else if (key === "whatsapp_number") el.href = `https://wa.me/${v.replace(/\D/g, "")}`;
      else el.href = v;
      if (el.dataset.text !== "keep") el.textContent = key.endsWith("_url") ? el.textContent : v;
    } else el.textContent = v;
    el.hidden = false;
  });
}

/** Wire a simple JSON form (prayer, contact). */
export function jsonForm(form, path, { onSuccess } = {}) {
  const status = form.querySelector("[data-status]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
    const fd = new FormData(form);
    const body = {};
    for (const [k, v] of fd.entries()) body[k] = v;
    form.querySelectorAll('input[type="checkbox"]').forEach((c) => { body[c.name] = c.checked; });
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    status.className = "notice"; status.hidden = true;
    try {
      const data = await api(path, { method: "POST", body });
      status.textContent = data.message || "Sent — thank you!";
      status.className = "notice ok"; status.hidden = false;
      form.reset();
      onSuccess?.(data);
    } catch (err) {
      for (const [k, msg] of Object.entries(err.details || {})) {
        const field = form.querySelector(`[name="${k}"]`)?.closest(".field");
        if (field) { field.classList.add("invalid"); const er = field.querySelector(".error"); if (er) er.textContent = msg; }
      }
      status.textContent = err.message; status.className = "notice err"; status.hidden = false;
    } finally { btn.disabled = false; }
  });
}

document.getElementById("year")?.replaceChildren(String(new Date().getFullYear()));

/** Underline the nav item for the page or home-page section the visitor is on. */
function initCurrentNav() {
  const links = [...document.querySelectorAll(".main-nav a, .menu nav a, .site-footer a, .subnav a, .tabbar a")];
  const mark = (match) => links.forEach((a) => {
    const on = match(new URL(a.href, location.href));
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const norm = (p) => p.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  const path = { "/event": "/events", "/index": "/" }[norm(location.pathname)] || norm(location.pathname);
  mark((u) => norm(u.pathname) === path && !u.hash);
}
initCurrentNav();
initHeader();
document.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
document.querySelectorAll("[data-to-top]").forEach((b) => b.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" })));
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
import("./consent.js").then(() => import("./install.js")).catch(() => {});
initReveal();
fillSettings();
