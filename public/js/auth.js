import { veilCarry, veilHide, veilShow } from "./switcher.js";
// Sign in with Google (Google Identity Services) or email + password (signin.js). No codes for normal sign-ins.
import { api, esc, toast } from "./site.js";
import { badgeHtml, cacheMe, cachedMe, playWelcome, renderPortalNav } from "./portal.js";

// Draw the portal bar from the last known sign-in straight away (no jump), then confirm with the server.
renderPortalNav(cachedMe());

let mePromise;
export function getMe(force = false) {
  if (force || !mePromise) mePromise = api("/api/auth/me").catch(() => ({ user: null }));
  return mePromise;
}

let gsiLoaded;
function loadGsi() {
  gsiLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load Google sign-in."));
    document.head.append(s);
  });
  return gsiLoaded;
}

let onSignedIn = [];
let gsiReady = false;
/** Register a callback for when someone finishes signing in on this page. */
export function whenSignedIn(cb) { onSignedIn.push(cb); }

/** A page can take over what happens after sign-in (the admin page opens its dashboard in place). */
let customDone = null;
export function onSignInDone(fn) { customDone = fn; }

// The account is confirmed (Google or password): from here on a calm "preparing" screen stays up until the person's
// page is fully ready, so the sign-in card never shows through.
export async function finishSignIn(result) {
  document.querySelectorAll(".gsi-waiting").forEach((el) => el.classList.remove("gsi-waiting"));
  const here = location.pathname.replace(/\.html$/, "");
  const onMe = here === "/me" || here === "/assistant", midTask = /^\/(join|event|membership|ticket|presenter)$/.test(here);
  veilShow(onMe ? "Preparing your member page…" : "Signing you in…");
  try {
    await (typeof result === "function" ? result() : result);
    const me = await getMe(true);
    cacheMe(me);
    if (customDone) { veilHide(); await customDone(me); return; }
    renderPortalNav(me); renderHeaderUser(me);
    document.getElementById("signin-dialog")?.close();
    // Members and the team: the hand-written welcome plays straight away while their page loads behind it.
    const welcomeThenGo = async (url) => {
      veilHide();
      const t0 = Date.now();
      await playWelcome(me).catch(() => null);
      const l = document.createElement("link"); l.rel = "prefetch"; l.href = url; document.head.append(l);
      await new Promise((r) => setTimeout(r, Math.max(0, 3900 - (Date.now() - t0))));
      location.href = url;   // the next page keeps the finished welcome up until it's ready
    };
    if (me.admin_account && !midTask) { await welcomeThenGo("/admin/"); return; }
    if (!onMe && !midTask) {
      if (me.member || me.is_admin || me.visitor) { await welcomeThenGo("/me"); return; }
      const label = "Setting up your sign-up…"; veilShow(label); veilCarry(label);   // new people go to the join form
      location.href = "/join";
      return;
    }
    if (onMe) {
      veilHide();
      const t0 = Date.now(), el = await playWelcome(me).catch(() => null);
      try { sessionStorage.removeItem("scc-welcome"); } catch { /* fine */ }
      await Promise.all(onSignedIn.map((cb) => Promise.resolve().then(() => cb(me)).catch(() => {})));
      setTimeout(() => { el?.classList.add("out"); setTimeout(() => el?.remove(), 460); }, Math.max(300, 4600 - (Date.now() - t0)));
      return;
    }
    veilShow("Filling in your details…");
    await Promise.all(onSignedIn.map((cb) => Promise.resolve().then(() => cb(me)).catch(() => {})));
    veilHide();
    toast(`Welcome${me.user?.given_name ? ", " + me.user.given_name : ""}!`);
  } catch (e) { veilHide(); toast(e.message); throw e; }
}
const handleCredential = (resp) => finishSignIn(() => api("/api/auth/google", { method: "POST", body: { credential: resp.credential } })).catch(() => {});

// While Google's window is open, the button says so (instead of looking like nothing happened).
function watchGoogleButton(el) {
  if (el.dataset.watch) return; el.dataset.watch = "1";
  let wait = el.querySelector(".gsi-wait");
  if (!wait) { wait = document.createElement("span"); wait.className = "gsi-wait"; wait.setAttribute("aria-live", "polite"); wait.innerHTML = '<i class="spinner" aria-hidden="true"></i>Waiting for Google…'; el.append(wait); }
  addEventListener("blur", () => setTimeout(() => { if (el.contains(document.activeElement)) el.classList.add("gsi-waiting"); }, 0));
  addEventListener("focus", () => setTimeout(() => el.classList.remove("gsi-waiting"), 1500));
  wait.addEventListener("click", () => el.classList.remove("gsi-waiting"));   // tap to try again
}

/** Render a Google button into `el`. Returns false if Google sign-in isn't configured. */
export async function googleButton(el, { text = "continue_with", width, round = false, card = false } = {}) {
  const me = await getMe();
  const clientId = me.google_client_id;
  if (!clientId || !el) { if (el) el.hidden = true; return false; }
  try { await loadGsi(); } catch { el.hidden = true; return false; }
  if (!gsiReady) { google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, ux_mode: "popup", auto_select: false, itp_support: true }); gsiReady = true; }
  if (round) google.accounts.id.renderButton(el, { type: "icon", theme: "outline", size: "large", shape: "circle" });
  else if (card) google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text, logo_alignment: "center", width: Math.min(400, Math.max(240, el.clientWidth || 320)) });
  else google.accounts.id.renderButton(el, { theme: document.body.classList.contains("admin") ? "filled_black" : "outline", size: "large", shape: "pill", text, logo_alignment: "left", width: width || Math.min(360, el.clientWidth || 320) });
  el.hidden = false;
  if (!round && !card) { watchGoogleButton(el); emailLink(el); }
  if (card) watchGoogleButton(el);
  return true;
}

/** Under every standalone Google button: a quiet way to use email + password instead. */
function emailLink(el) {
  if (el.closest(".si-card") || el.nextElementSibling?.classList.contains("si-alt")) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = "si-alt"; b.textContent = "Use email and password instead";
  b.addEventListener("click", () => openSignIn());
  el.after(b);
}

/** The sign-in card, for pages that show it in place (member Home). */
export async function signInCard(host, opts = {}) {
  const { mountSignIn } = await import("./signin.js");
  return mountSignIn(host, { google: (g) => googleButton(g, { card: true, text: g.dataset.text || "signin_with" }), onDone: (r) => finishSignIn(r), ...opts });
}

export async function signOut() {
  cacheMe(null);
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  try { google?.accounts?.id?.disableAutoSelect(); } catch { /* not loaded */ }
  location.href = "/";
}

/** Header: show avatar + menu when signed in, otherwise a "Sign in" button. */
export function renderHeaderUser(me) {
  const slot = document.querySelector("[data-user-slot]");
  if (!slot) return;
  if (!me?.user) {
    slot.innerHTML = `<button class="btn btn-ghost btn-sm" data-signin>Sign in</button>`;
    slot.querySelector("[data-signin]")?.addEventListener("click", openSignIn);
    return;
  }
  const u = me.user;
  const initials = (u.given_name || u.name || u.email || "?").slice(0, 1).toUpperCase();
  const avatar = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(initials)}</span>`;
  slot.innerHTML = `<details class="user-menu"><summary aria-label="Account menu" class="avatar">${avatar}</summary>
    <div class="user-pop"><b>${esc(u.name || u.email)}${badgeHtml(me, 16)}</b><small>${esc(u.email)}</small>
      ${me.admin_account ? "" : `<a href="/me">Home</a>`}
      <a href="/devotions">Devotions</a>
      <a href="/assistant">Ask SCC</a>
      <a href="/vote">Vote</a>
      ${me.admin_account ? `<a href="/admin/">Admin</a>` : ""}
      <a href="/settings">Settings</a>
      ${!me.member && !me.admin_account ? `<a href="/join">Complete joining</a>` : ""}
      <button type="button" data-signout>Sign out</button></div></details>`;
  slot.querySelector("[data-signout]").addEventListener("click", signOut);
  // Hide "Join" buttons for people who've already joined (and the admin, who never needs to).
  if (me.member || me.admin_account) document.querySelectorAll("[data-join-cta]").forEach((a) => {
    a.href = me.admin_account ? "/admin/" : "/me";
    // Bottom bar: keep the person icon on every device, only the short label changes.
    if (a.hasAttribute("data-tab-me")) { const s = a.querySelector("span"); if (s) s.textContent = me.admin_account ? "Admin" : "My SCC"; a.setAttribute("aria-label", me.admin_account ? "Admin dashboard" : "My church home"); }
    else a.textContent = me.admin_account ? "Dashboard" : "My profile";
  });
}

export async function openSignIn(mode = "login") {
  let dlg = document.getElementById("signin-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "signin-dialog"; dlg.className = "sheet";
    dlg.innerHTML = `<div class="si-pop"><button class="close" type="button" data-close aria-label="Close">✕</button><section class="si-card"></section></div>`;
    document.body.append(dlg);
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }
  const card = await signInCard(dlg.querySelector(".si-card"), { mode: typeof mode === "string" ? mode : "login" });
  card.show(typeof mode === "string" ? mode : "login");
  if (!dlg.open) dlg.showModal();
}

document.addEventListener("click", (e) => { if (e.target.closest?.("[data-app-signout]")) { e.preventDefault(); signOut(); } });
getMe().then((me) => {
  cacheMe(me); renderPortalNav(me);
  renderHeaderUser(me);
  // Warm up Google sign-in in the background for signed-out visitors, so the button appears instantly.
  if (!me.user && me.google_client_id) (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => loadGsi().then(() => {
    google.accounts.id.initialize({ client_id: me.google_client_id, callback: handleCredential, ux_mode: "popup", auto_select: false, itp_support: true });
    gsiReady = true;
  }).catch(() => {}));
});
