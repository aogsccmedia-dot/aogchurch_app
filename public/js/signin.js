// One sign-in card for the whole site (member Home, the sign-in pop-up and the admin page):
// email + password, or Google. Codes are only emailed to prove an email the church already knows, or to reset a password.
import { icon } from "./icons.js";
import { otpField } from "./otp.js";

const H = { "Content-Type": "application/json", "x-scc-admin": "1" };
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KNOB = `<span class="si-knob" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
const go = (label) => `<button class="si-go" type="submit"><span class="si-go-t">${label}</span>${KNOB}</button>`;
const field = ({ name, type = "text", label, ico, auto, extra = "" }) => `
  <label class="si-field"><span class="si-lab">${label}</span>
    <span class="si-line"><input name="${name}" type="${type}" autocomplete="${auto}" ${extra} required placeholder=" ">${ico}</span></label>`;
const pwField = (label, auto) => `
  <label class="si-field"><span class="si-lab">${label}</span>
    <span class="si-line"><input name="password" type="password" autocomplete="${auto}" minlength="8" maxlength="200" required placeholder=" ">
      <button type="button" class="si-eye" data-eye aria-label="Show password" aria-pressed="false">${icon("eye")}</button></span></label>`;

/**
 * Render the card into `host`.
 *  google(el): draws the round Google button into el (resolves false if Google isn't set up)
 *  onDone(result): called once signed in with email + password
 *  mode: "login" | "signup"
 */
export function mountSignIn(host, { google, onDone, mode = "login", note = "" } = {}) {
  if (host._si) return host._si;
  host.classList.add("si-card");
  let state = { mode, email: "", challenge: null, purpose: null, sentTo: "" };

  const views = {
    login: () => `
      <p class="si-kicker">Login</p><h2 class="si-h">Welcome back!</h2>
      ${note ? `<p class="si-note">${note}</p>` : ""}
      <form class="si-form" data-form="login" novalidate>
        ${field({ name: "email", type: "email", label: "Email", ico: icon("mail"), auto: "username", extra: `inputmode="email" value="${esc(state.email)}"` })}
        ${pwField("Password", "current-password")}
        <button type="button" class="si-link si-forgot" data-to="forgot">Forgot password?</button>
        <p class="si-err" role="alert" hidden></p>
        ${go("Sign In")}
      </form>
      <div class="si-or"><span>OR</span></div>
      <div class="si-social"><span>Sign in with</span><div class="si-g" data-g></div></div>
      <p class="si-swap">Don't have an account? <button type="button" class="si-link" data-to="signup">Sign up</button></p>`,
    signup: () => `
      <p class="si-kicker">Sign up</p><h2 class="si-h">Join the family!</h2>
      <form class="si-form" data-form="signup" novalidate>
        ${field({ name: "name", label: "Your name", ico: icon("user"), auto: "name", extra: `maxlength="80"` })}
        ${field({ name: "email", type: "email", label: "Email", ico: icon("mail"), auto: "email", extra: `inputmode="email" value="${esc(state.email)}"` })}
        ${pwField("Create a password", "new-password")}
        <p class="si-hint">At least 8 characters. A short phrase is easy to remember.</p>
        <p class="si-err" role="alert" hidden></p>
        ${go("Sign Up")}
      </form>
      <div class="si-or"><span>OR</span></div>
      <div class="si-social"><span>Sign up with</span><div class="si-g" data-g></div></div>
      <p class="si-swap">Already have an account? <button type="button" class="si-link" data-to="login">Sign in</button></p>`,
    forgot: () => `
      <p class="si-kicker">Forgot password</p><h2 class="si-h">Let's get you back in</h2>
      <p class="si-note">Enter your email and we'll send you a 6-digit code.</p>
      <form class="si-form" data-form="forgot" novalidate>
        ${field({ name: "email", type: "email", label: "Email", ico: icon("mail"), auto: "username", extra: `inputmode="email" value="${esc(state.email)}"` })}
        <p class="si-err" role="alert" hidden></p>
        ${go("Send code")}
      </form>
      <p class="si-swap"><button type="button" class="si-link" data-to="login">← Back to sign in</button></p>`,
    code: () => `
      <p class="si-kicker">${state.purpose === "reset" ? "New password" : "Confirm your email"}</p><h2 class="si-h">Check your email</h2>
      <p class="si-note">We sent a 6-digit code to <b>${esc(state.sentTo)}</b>. Not there? Look in Spam or Promotions.</p>
      <form class="si-form" data-form="code" novalidate>
        <input class="input" name="code" aria-label="6-digit code">
        ${state.purpose === "reset" ? pwField("New password", "new-password") : ""}
        <p class="si-err" role="alert" hidden></p>
        ${go(state.purpose === "reset" ? "Save & sign in" : "Confirm")}
      </form>
      <p class="si-swap"><button type="button" class="si-link" data-resend>Send a new code</button> · <button type="button" class="si-link" data-to="login">Back</button></p>`,
  };

  function show(m) {
    state.mode = m;
    host.dataset.mode = m;
    host.innerHTML = views[m]();
    const g = host.querySelector("[data-g]");
    if (g && google) Promise.resolve(google(g)).then((ok) => { if (!ok) { host.querySelector(".si-or")?.remove(); host.querySelector(".si-social")?.remove(); } }).catch(() => {});
    else if (g) { host.querySelector(".si-or")?.remove(); host.querySelector(".si-social")?.remove(); }
    const code = host.querySelector("[name=code]");
    if (code) otpField(code, () => { if (state.purpose !== "reset") host.querySelector("form").requestSubmit(); else host.querySelector("[name=password]")?.focus(); });
    const first = host.querySelector(m === "code" ? "[name=code]" : "input:not([value]):not([value='']), input");
    if (matchMedia("(pointer: fine)").matches) first?.focus({ preventScroll: true });
  }

  host.addEventListener("click", (e) => {
    const to = e.target.closest("[data-to]");
    if (to) { const em = host.querySelector("[name=email]")?.value; if (em) state.email = em; show(to.dataset.to); return; }
    const eye = e.target.closest("[data-eye]");
    if (eye) {
      const inp = eye.parentElement.querySelector("input"), on = inp.type === "password";
      inp.type = on ? "text" : "password"; eye.innerHTML = icon(on ? "eyeOff" : "eye");
      eye.setAttribute("aria-pressed", String(on)); eye.setAttribute("aria-label", on ? "Hide password" : "Show password");
      return;
    }
    const resend = e.target.closest("[data-resend]");
    if (resend) {
      resend.disabled = true; resend.textContent = "Sending…";
      const again = state.purpose === "reset" ? post("/api/auth/password/forgot", { email: state.email }) : post("/api/auth/password/signup", state.signup);
      again.then((r) => { state.challenge = r.challenge; resend.textContent = "Sent ✓"; setTimeout(() => { resend.disabled = false; resend.textContent = "Send a new code"; }, 30000); })
        .catch((err) => { resend.disabled = false; resend.textContent = "Send a new code"; say(err.message); });
    }
  });

  const say = (msg) => { const el = host.querySelector(".si-err"); if (el) { el.textContent = msg || ""; el.hidden = !msg; } };
  let working = false;
  host.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (working) return;
    const f = e.target, kind = f.dataset.form, v = Object.fromEntries(new FormData(f));
    say("");
    if (v.email !== undefined) {
      v.email = String(v.email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) { say("Please enter a valid email address."); f.email.focus(); return; }
      state.email = v.email;
    }
    if (kind === "signup" && String(v.name || "").trim().length < 2) { say("Please add your name."); f.name.focus(); return; }
    if ((kind === "signup" || (kind === "code" && state.purpose === "reset")) && String(v.password || "").length < 8) { say("Use at least 8 characters for your password."); f.password.focus(); return; }
    if (kind === "login" && !v.password) { say("Enter your password."); f.password.focus(); return; }
    if (kind === "code" && String(v.code || "").replace(/\D/g, "").length !== 6) { say("Enter the 6-digit code from your email."); return; }
    working = true; f.classList.add("busy"); f.querySelector(".si-go")?.setAttribute("aria-busy", "true");
    try {
      if (kind === "login") { await onDone?.(await post("/api/auth/password/login", { email: v.email, password: v.password })); return; }
      if (kind === "signup") {
        state.signup = { name: v.name, email: v.email, password: v.password };
        const r = await post("/api/auth/password/signup", state.signup);
        if (r.needs_code) { Object.assign(state, { challenge: r.challenge, sentTo: r.sent_to, purpose: "signup" }); show("code"); return; }
        await onDone?.(r); return;
      }
      if (kind === "forgot") {
        const r = await post("/api/auth/password/forgot", { email: v.email });
        Object.assign(state, { challenge: r.challenge, sentTo: r.sent_to, purpose: "reset" }); show("code"); return;
      }
      if (kind === "code") { await onDone?.(await post("/api/auth/password/confirm", { challenge: state.challenge, code: v.code, password: v.password })); return; }
    } catch (err) {
      say(err.message);
      if (kind === "code") { const c = f.code; c.value = ""; c.dispatchEvent(new Event("input")); c.focus(); }
    } finally { working = false; f.classList.remove("busy"); f.querySelector(".si-go")?.removeAttribute("aria-busy"); }
  });

  show(mode);
  host._si = { show };
  return host._si;
}

/** Big screens only: add the photos and the drifting specks around the card. Phones keep just the card. */
export function dressScene(scene) {
  const wide = matchMedia("(min-width: 900px)");
  const apply = () => {
    if (!wide.matches || scene.querySelector(".si-art")) return;
    scene.querySelector(".si-stage")?.insertAdjacentHTML("afterbegin", ART);
    dust(scene);
  };
  apply(); wide.addEventListener?.("change", apply);
}

/**
 * Tiny drifting specks for big screens: barely visible, moving together along a slow, smooth current.
 * Off on phones, on touch screens and for anyone who prefers reduced motion. Pauses when the tab is hidden.
 */
export function dust(scene) {
  if (!matchMedia("(min-width: 900px) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (scene.querySelector(".si-dust")) return;
  const c = document.createElement("canvas"); c.className = "si-dust"; c.setAttribute("aria-hidden", "true");
  scene.prepend(c);
  const x = c.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
  const tones = ["214,166,80", "155,124,230", "92,196,170", "240,140,150", "110,170,240"];
  let W = 0, Ht = 0, pts = [], raf = 0, t = 0;
  const size = () => {
    W = scene.clientWidth; Ht = scene.clientHeight; c.width = W * dpr; c.height = Ht * dpr; c.style.width = W + "px"; c.style.height = Ht + "px";
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(110, (W * Ht) / 14000));
    pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * Ht, r: 0.5 + Math.random() * 1.1, a: 0.18 + Math.random() * 0.32, c: tones[(Math.random() * tones.length) | 0], s: 0.12 + Math.random() * 0.22, ph: Math.random() * 6.28 }));
  };
  const frame = () => {
    t += 0.0016;
    x.clearRect(0, 0, W, Ht);
    for (const p of pts) {
      // A gentle shared current (smooth sine field), so the specks drift as one, like dust in sunlight.
      const ang = Math.sin(p.y * 0.0042 + t * 2) + Math.cos(p.x * 0.0036 - t * 1.6) * 0.8;
      p.x += Math.cos(ang) * p.s + 0.06; p.y += Math.sin(ang) * p.s - 0.03;
      if (p.x > W + 4) p.x = -4; if (p.x < -4) p.x = W + 4; if (p.y > Ht + 4) p.y = -4; if (p.y < -4) p.y = Ht + 4;
      const tw = 0.65 + 0.35 * Math.sin(t * 40 + p.ph);
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, 6.2832); x.fillStyle = `rgba(${p.c},${(p.a * tw).toFixed(3)})`; x.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  size(); frame();
  new ResizeObserver(() => size()).observe(scene);
  document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); if (!document.hidden && scene.isConnected && !scene.closest("[hidden]")) frame(); });
}

/** The picture side for big screens: three tilted church photos with colourful labels. Not drawn on phones. */
export const ART = `<div class="si-art" aria-hidden="true">
  <figure class="si-ph si-ph-1"><img src="/assets/photos/worship-800.webp" alt="" loading="lazy" decoding="async" width="800" height="1000"><figcaption>Worship</figcaption></figure>
  <figure class="si-ph si-ph-2"><img src="/assets/photos/congregation-800.webp" alt="" loading="lazy" decoding="async" width="800" height="1000"><figcaption>Family</figcaption></figure>
  <figure class="si-ph si-ph-3"><img src="/assets/photos/hospitality-800.webp" alt="" loading="lazy" decoding="async" width="800" height="1000"><figcaption>Go Ye</figcaption></figure>
  <p class="si-art-line">Sandton City Church<br><b>Youth &amp; Family</b></p>
</div>`;
