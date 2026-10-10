import { veilCarry, veilHide, veilShow } from "./switcher.js";   // also wires data-switch buttons (member ⇄ admin)
// Sign in with Google (Google Identity Services) + the admin's emailed verification code.
import { api, esc, toast } from "./site.js";
import { busy, otpField } from "./otp.js";

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

// Google has confirmed the account: from here on a calm "preparing" screen stays up until the person's
// page is fully ready, so the old "Sign in with Google" button never shows through.
async function handleCredential(resp) {
  document.querySelectorAll(".gsi-waiting").forEach((el) => el.classList.remove("gsi-waiting"));
  const here = location.pathname.replace(/\.html$/, "");
  const onMe = here === "/me", midTask = /^\/(join|event|membership|ticket)$/.test(here);
  veilShow(onMe ? "Preparing your member page…" : "Signing you in…");
  try {
    const r = await api("/api/auth/google", { method: "POST", body: { credential: resp.credential } });
    if (r.needs_code) { veilHide(); await adminCodeDialog(r.challenge, r.sent_to); return; }
    const me = await getMe(true);
    renderHeaderUser(me);
    if (!onMe && !midTask) {
      // Members go to their profile; new people go to the join form, already filled in from Google.
      const label = me.member ? "Preparing your member page…" : "Setting up your sign-up…";
      veilShow(label); veilCarry(label);
      location.href = me.member ? "/me" : "/join";
      return;   // the next page fades the veil out once it has loaded
    }
    if (!onMe) veilShow("Filling in your details…");
    await Promise.all(onSignedIn.map((cb) => Promise.resolve().then(() => cb(me)).catch(() => {})));
    veilHide();
    toast(`Welcome${me.user?.given_name ? ", " + me.user.given_name : ""}!`);
  } catch (e) { veilHide(); toast(e.message); }
}

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
export async function googleButton(el, { text = "continue_with", width } = {}) {
  const me = await getMe();
  const clientId = me.google_client_id;
  if (!clientId || !el) { if (el) el.hidden = true; return false; }
  try { await loadGsi(); } catch { el.hidden = true; return false; }
  if (!gsiReady) { google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, ux_mode: "popup", auto_select: false, itp_support: true }); gsiReady = true; }
  google.accounts.id.renderButton(el, { theme: document.body.classList.contains("admin") ? "filled_black" : "outline", size: "large", shape: "pill", text, logo_alignment: "left", width: width || Math.min(360, el.clientWidth || 320) });
  el.hidden = false;
  watchGoogleButton(el);
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
      <input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
      <div class="notice err" data-status hidden></div>
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost" data-resend>Resend code</button>
        <button type="submit" class="btn btn-gold">Verify &amp; open dashboard</button>
      </div></form>`;
    const form = dlg.querySelector("form");
    otpField(form.code, () => form.requestSubmit());
    const status = dlg.querySelector("[data-status]");
    let ch = challenge;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.hidden = true;
      const stop = busy("Checking your code…");
      try {
        await api("/api/auth/admin/verify", { method: "POST", body: { challenge: ch, code: form.code.value } });
        dlg.close(); resolve(true);
        location.href = "/admin/";
      } catch (err) { status.textContent = err.message; status.hidden = false; form.code.value = ""; form.code.dispatchEvent(new Event("input")); form.code.focus(); }
      finally { stop(); }
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
      ${me.admin_account ? "" : `<a href="/me">My profile</a>`}
      ${me.admin_account ? `<a href="/admin/">Admin dashboard</a>` : me.can_admin || me.is_admin ? `<button type="button" class="switch-row" data-switch="admin"><span>Switch to admin</span><small>${me.is_admin ? "Ready" : "Code by email"}</small></button>` : ""}
      ${!me.member && !me.admin_account ? `<a href="/join">Complete joining</a>` : ""}
      <button type="button" data-signout>Sign out</button></div></details>`;
  slot.querySelector("[data-signout]").addEventListener("click", signOut);
  // Hide "Join" buttons for people who've already joined (and the admin, who never needs to).
  if (me.member || me.admin_account) document.querySelectorAll("[data-join-cta]").forEach((a) => {
    a.href = me.admin_account ? "/admin/" : "/me";
    // Bottom bar: keep the person icon on every device, only the short label changes.
    if (a.hasAttribute("data-tab-me")) { const s = a.querySelector("span"); if (s) s.textContent = me.admin_account ? "Admin" : "Profile"; a.setAttribute("aria-label", me.admin_account ? "Admin dashboard" : "My profile"); }
    else a.textContent = me.admin_account ? "Dashboard" : "My profile";
  });
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

getMe().then((me) => {
  renderHeaderUser(me);
  // Warm up Google sign-in in the background for signed-out visitors, so the button appears instantly.
  if (!me.user && me.google_client_id) (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => loadGsi().then(() => {
    google.accounts.id.initialize({ client_id: me.google_client_id, callback: handleCredential, ux_mode: "popup", auto_select: false, itp_support: true });
    gsiReady = true;
  }).catch(() => {}));
});
