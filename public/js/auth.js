// Sign in with Google (Google Identity Services) + the admin's emailed verification code.
import { api, esc, toast } from "./site.js";

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
/** Register a callback for when someone finishes signing in on this page. */
export function whenSignedIn(cb) { onSignedIn.push(cb); }

async function handleCredential(resp) {
  try {
    const r = await api("/api/auth/google", { method: "POST", body: { credential: resp.credential } });
    if (r.needs_code) { await adminCodeDialog(r.challenge, r.sent_to); return; }
    const me = await getMe(true);
    toast(`Welcome${me.user?.given_name ? ", " + me.user.given_name : ""}!`);
    renderHeaderUser(me);
    onSignedIn.forEach((cb) => cb(me));
  } catch (e) { toast(e.message); }
}

/** Render a Google button into `el`. Returns false if Google sign-in isn't configured. */
export async function googleButton(el, { text = "continue_with", width } = {}) {
  const me = await getMe();
  const clientId = me.google_client_id;
  if (!clientId || !el) { if (el) el.hidden = true; return false; }
  try { await loadGsi(); } catch { el.hidden = true; return false; }
  google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, ux_mode: "popup", auto_select: false, itp_support: true });
  google.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", text, logo_alignment: "left", width: width || Math.min(360, el.clientWidth || 320) });
  el.hidden = false;
  return true;
}

/** Modal that asks the admin for the 6-digit emailed code. */
export function adminCodeDialog(challenge, sentTo) {
  return new Promise((resolve) => {
    let dlg = document.getElementById("code-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "code-dialog"; dlg.className = "sheet";
      document.body.append(dlg);
    }
    dlg.innerHTML = `<form method="dialog" class="code-form">
      <p class="eyebrow gold">Admin verification</p>
      <h3>Check your email</h3>
      <p class="muted-text">We sent a 6-digit code to <b>${esc(sentTo)}</b>. It expires in 10 minutes.</p>
      <input class="input code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="••••••" required>
      <div class="notice err" data-status hidden></div>
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost" data-resend>Resend code</button>
        <button type="submit" class="btn btn-gold">Verify &amp; open dashboard</button>
      </div></form>`;
    const form = dlg.querySelector("form");
    const status = dlg.querySelector("[data-status]");
    let ch = challenge;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.hidden = true;
      try {
        await api("/api/auth/admin/verify", { method: "POST", body: { challenge: ch, code: form.code.value } });
        dlg.close(); resolve(true);
        location.href = "/admin/";
      } catch (err) { status.textContent = err.message; status.hidden = false; form.code.select(); }
    });
    dlg.querySelector("[data-resend]").addEventListener("click", async () => {
      try { const r = await api("/api/auth/admin/request-code", { method: "POST", body: {} }); ch = r.challenge; toast("New code sent"); }
      catch (err) { status.textContent = err.message; status.hidden = false; }
    });
    dlg.showModal();
    form.code.focus();
  });
}

export async function signOut() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  try { google?.accounts?.id?.disableAutoSelect(); } catch { /* not loaded */ }
  location.href = "/";
}

/** Header: show avatar + menu when signed in, otherwise a "Sign in" button. */
export function renderHeaderUser(me) {
  const slot = document.querySelector("[data-user-slot]");
  if (!slot) return;
  if (!me?.user) {
    slot.innerHTML = me?.google_client_id ? `<button class="btn btn-ghost btn-sm" data-signin>Sign in</button>` : "";
    slot.querySelector("[data-signin]")?.addEventListener("click", openSignIn);
    return;
  }
  const u = me.user;
  const initials = (u.given_name || u.name || u.email || "?").slice(0, 1).toUpperCase();
  const avatar = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<span>${esc(initials)}</span>`;
  slot.innerHTML = `<details class="user-menu"><summary aria-label="Account menu" class="avatar">${avatar}</summary>
    <div class="user-pop"><b>${esc(u.name || u.email)}</b><small>${esc(u.email)}</small>
      ${me.is_admin || me.admin_account ? `<a href="/admin/">Admin dashboard</a>` : `<a href="/me">My profile</a>`}
      ${!me.member && !me.admin_account ? `<a href="/join">Complete joining</a>` : ""}
      <button type="button" data-signout>Sign out</button></div></details>`;
  slot.querySelector("[data-signout]").addEventListener("click", signOut);
  // Hide "Join" buttons for people who've already joined (and the admin, who never needs to).
  if (me.member || me.admin_account) document.querySelectorAll("[data-join-cta]").forEach((a) => { a.textContent = me.admin_account ? "Dashboard" : "My profile"; a.href = me.admin_account ? "/admin/" : "/me"; });
}

export async function openSignIn() {
  let dlg = document.getElementById("signin-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "signin-dialog"; dlg.className = "sheet";
    dlg.innerHTML = `<div class="signin-sheet"><button class="icon-btn close" data-close aria-label="Close">✕</button>
      <img src="/assets/logo-192.png" alt="" width="64" height="64" style="border-radius:50%">
      <h3>Welcome home</h3><p class="muted-text">Sign in with Google to join faster, register for events in one tap and manage your weekly letter.</p>
      <div class="gbtn"></div></div>`;
    document.body.append(dlg);
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    whenSignedIn(() => dlg.close());
  }
  dlg.showModal();
  await googleButton(dlg.querySelector(".gbtn"), { text: "signin_with", width: 300 });
}

getMe().then(renderHeaderUser);
