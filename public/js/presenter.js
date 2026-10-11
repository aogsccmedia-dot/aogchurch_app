// SCC Presenter beta page: places left, sign in (Google or email + password), join, download, feedback.
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn, renderHeaderUser } from "./auth.js";
import { otpField } from "./otp.js";
import { icon } from "./icons.js";

const card = document.getElementById("pres-card");
const ua = navigator.userAgent;
const isPhone = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua) || (/iPad|Android/i.test(ua) && navigator.maxTouchPoints > 1 && !/Macintosh/.test(ua)) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const myOs = /Mac/i.test(navigator.platform || ua) && !isPhone ? "mac" : /Win/i.test(navigator.platform || ua) ? "windows" : null;
const OS = { windows: { name: "Windows", note: "Windows 10 or 11 · 64-bit", file: "SCC-Presenter-Setup.exe" }, mac: { name: "Mac", note: "Apple Silicon & Intel · macOS 11+", file: "SCC-Presenter.dmg" } };
const fmt = (iso) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00"));
let state = null;

const MSG = { signin: "Please sign in to download.", join: "Join the beta to download.", ended: "The beta has ended. The full release arrives on 31 January 2027.", preparing: "The download is being prepared. Please check back in a few minutes." };

async function load() {
  state = await api("/api/presenter/status");
  render();
}

function placesBar(s) {
  const pct = Math.round((s.taken / s.slots) * 100);
  return `<div class="places"><div class="places-top"><b>${s.left}</b> of ${s.slots} beta places left</div><div class="places-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${s.slots}" aria-valuenow="${s.taken}"><i style="width:${pct}%"></i></div></div>`;
}

function render() {
  const s = state;
  if (s.ended) {
    card.innerHTML = `<p class="eyebrow gold">Beta closed</p><h2>Thank you, testers!</h2><p>The beta ended on ${fmt(s.ends)}. The full release of SCC Presenter arrives on <b>${fmt(s.full_release)}</b>.</p><span class="soon-chip">${icon("calendar")} Coming soon · ${fmt(s.full_release)}</span>`;
    return;
  }
  if (s.tester) return renderTester(s);
  if (!s.signed_in) return renderSignIn(s);
  if (!s.open) {
    card.innerHTML = `<p class="eyebrow gold">Beta full</p><h2>All 20 places are taken</h2><p>Thank you for your interest. The full release of SCC Presenter arrives on <b>${fmt(s.full_release)}</b>, free for every church.</p><span class="soon-chip">${icon("calendar")} Coming ${fmt(s.full_release)}</span>`;
    return;
  }
  renderJoin(s);
}

function renderSignIn(s) {
  card.innerHTML = `<p class="eyebrow gold">Join the beta</p><h2>Be one of the first 20 testers</h2>
    ${placesBar(s)}
    <p class="muted-text">Sign in, claim your place and download SCC Presenter. Testing runs until ${fmt(s.ends)}.</p>
    <div class="gbtn" id="pres-g"></div>
    <div class="or"><span>or use email</span></div>
    <div class="seg pres-tabs" role="tablist"><button class="on" data-mode="new">Create account</button><button data-mode="login">Sign in</button></div>
    <form class="pres-form" id="pw-form" novalidate>
      <label class="field" data-only="new"><span>Your name</span><input class="input" name="name" autocomplete="name" maxlength="80"></label>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span id="pw-label">Password</span><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required><small data-only="new">At least 8 characters.</small></label>
      <button class="btn btn-gold" type="submit">Create account</button>
      <button class="linkish" type="button" data-only="login" id="pw-forgot">Forgot your password?</button>
    </form>`;
  googleButton(document.getElementById("pres-g"), { text: "continue_with", width: 320 });
  const form = card.querySelector("#pw-form");
  let mode = "new";
  const setMode = (m) => {
    mode = m;
    card.querySelectorAll(".pres-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    card.querySelectorAll("[data-only]").forEach((el) => { el.hidden = el.dataset.only !== m; });
    form.querySelector('[type="submit"]').textContent = m === "new" ? "Create account" : m === "reset" ? "Email me a code" : "Sign in";
    form.password.autocomplete = m === "login" ? "current-password" : "new-password";
    card.querySelector('#pw-label').textContent = m === "reset" ? "New password" : "Password";
  };
  card.querySelector(".pres-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  card.querySelector("#pw-forgot").addEventListener("click", () => { setMode("reset"); form.password.value = ""; form.password.focus(); toast("Type a new password, then we'll email you a code."); });
  setMode("new");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim(), password = form.password.value, name = form.name.value.trim();
    if (!email || !form.email.checkValidity()) return toast("Enter a valid email address.");
    if (password.length < 8) return toast("Use a password of at least 8 characters.");
    try {
      if (mode === "login") { await api("/api/auth/password/login", { method: "POST", body: { email, password } }); return signedIn(); }
      const r = await api("/api/auth/password/start", { method: "POST", body: { email, password, name } });
      codeStep(r.challenge, email);
    } catch (err) { toast(err.message); }
  });
}

function codeStep(challenge, email) {
  card.innerHTML = `<p class="eyebrow gold">Check your email</p><h2>Enter your 6-digit code</h2><p class="muted-text">We sent a code to <b>${esc(email)}</b>. It expires in 10 minutes. Check spam if you don't see it.</p>
    <form class="pres-form" id="code-form"><input class="input" id="code-in"><button class="btn btn-gold" type="submit">Confirm</button><button class="linkish" type="button" id="code-back">Use a different email</button></form>`;
  const input = card.querySelector("#code-in");
  const go = async () => {
    try { await api("/api/auth/password/verify", { method: "POST", body: { challenge, code: input.value } }); await signedIn(); }
    catch (err) { toast(err.message); input.value = ""; input.dispatchEvent(new Event("input")); input.focus(); }
  };
  otpField(input, go);
  card.querySelector("#code-form").addEventListener("submit", (e) => { e.preventDefault(); go(); });
  card.querySelector("#code-back").addEventListener("click", () => renderSignIn(state));
  input.focus();
}

async function signedIn() {
  const me = await getMe(true);
  renderHeaderUser(me);
  await load();
  toast(`Welcome${me.user?.given_name ? ", " + me.user.given_name : ""}!`);
}

function renderJoin(s) {
  card.innerHTML = `<p class="eyebrow gold">Join the beta</p><h2>Claim your place${s.user?.name ? `, ${esc(s.user.name)}` : ""}</h2>
    ${placesBar(s)}
    <form class="pres-form" id="join-form">
      <label class="field"><span>Your church or ministry</span><input class="input" name="church" maxlength="120" placeholder="e.g. AOG Sandton City Church"></label>
      <label class="field"><span>What do you do on Sundays?</span><select class="input" name="role"><option value="">Choose…</option><option>Media / projection</option><option>Worship team</option><option>Pastor / leader</option><option>Livestream / sound</option><option>Other</option></select></label>
      <label class="field"><span>Your computer</span><select class="input" name="os"><option value="windows">Windows</option><option value="mac">Mac</option></select></label>
      <p class="fine">By joining you agree to try SCC Presenter and share honest feedback. We'll email your beta key to ${esc(s.user?.email || "you")}.</p>
      <button class="btn btn-gold" type="submit">Claim my beta place</button>
    </form>`;
  const f = card.querySelector("#join-form");
  if (myOs) f.os.value = myOs;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/presenter/join", { method: "POST", body: { church: f.church.value, role: f.role.value, os: f.os.value } }); await load(); toast("You're in! Your beta key is on its way by email."); }
    catch (err) { toast(err.message); await load(); }
  });
}

function renderTester(s) {
  const t = s.tester, rel = s.release;
  const order = myOs === "mac" ? ["mac", "windows"] : ["windows", "mac"];
  const btn = (os, primary) => rel && rel[os]
    ? `<a class="btn ${primary ? "btn-gold" : ""} dl-btn" href="/api/presenter/download/${os}" data-os="${os}">${icon("download")}<span><b>Download for ${OS[os].name}</b><small>${OS[os].note} · v${esc(rel.version)}</small></span></a>`
    : `<span class="btn dl-btn disabled">${icon("download")}<span><b>${OS[os].name}</b><small>Being prepared — check back soon</small></span></span>`;
  card.innerHTML = `<p class="eyebrow gold">Beta tester #${t.slot} of ${s.slots}</p><h2>You're in. Thank you!</h2>
    <div class="beta-key"><span>Your beta key</span><code id="bkey">${esc(t.beta_key)}</code><button class="btn btn-sm" type="button" id="bcopy">Copy</button></div>
    ${isPhone ? `<div class="phone-note">${icon("laptop")}<p><b>Open this page on your computer to download.</b> SCC Presenter is for Windows and Mac laptops and desktops.</p></div>` : `<div class="dl-row">${order.map((os, i) => btn(os, i === 0)).join("")}</div>`}
    <details class="install-help" ${t.downloads ? "" : "open"}><summary>How to install${icon("plus")}</summary>
      <ol>${(myOs === "mac" ? [
        "Open <b>SCC-Presenter.dmg</b> and drag SCC Presenter into Applications.",
        "The first time: Control-click the app → <b>Open</b> → Open. (Or System Settings → Privacy &amp; Security → <b>Open Anyway</b>.)",
        "Go to Settings → Beta in the app and paste your beta key.",
      ] : [
        "Open <b>SCC-Presenter-Setup.exe</b>. It installs in a few seconds and opens by itself.",
        "If Windows says “Windows protected your PC”, click <b>More info → Run anyway</b>. The beta isn't code-signed yet.",
        "Go to Settings → Beta in the app and paste your beta key.",
      ]).map((x) => `<li>${x}</li>`).join("")}</ol></details>
    <button class="btn" type="button" id="fb-open">${icon("messageCircle")} Send feedback</button>
    <p class="fine">Tip: the app also has a <b>Feedback</b> button at the top. Testing runs until ${fmt(s.ends)}.</p>`;
  card.querySelector("#bcopy").addEventListener("click", () => navigator.clipboard?.writeText(t.beta_key).then(() => toast("Beta key copied")));
  card.querySelector("#fb-open").addEventListener("click", feedbackForm);
  card.querySelectorAll(".dl-btn[data-os]").forEach((a) => a.addEventListener("click", () => {
    a.classList.add("loading"); a.querySelector("small").textContent = "Starting your download…";
    setTimeout(() => { a.classList.remove("loading"); a.querySelector("small").textContent = "Downloading — check your Downloads folder"; }, 2500);
  }));
}

function feedbackForm() {
  let dlg = document.getElementById("fb-dialog");
  dlg?.remove();
  dlg = document.createElement("dialog");
  dlg.id = "fb-dialog"; dlg.className = "sheet";
  const stars = (name) => `<div class="stars" data-name="${name}">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-v="${i}" aria-label="${i} of 5">★</button>`).join("")}</div>`;
  dlg.innerHTML = `<form class="fb-sheet" method="dialog"><button class="icon-btn close" type="button" data-close aria-label="Close">✕</button>
    <h3>Beta feedback</h3><p class="muted-text">Honest answers help us most. Only beta testers can send this.</p>
    <div class="field"><span>Overall</span>${stars("overall")}</div>
    <div class="field"><span>How easy is it to use?</span>${stars("ease")}</div>
    <label class="field"><span>Did it download and install without problems?</span><select class="input" name="install_ok"><option value="">Choose…</option><option value="yes">Yes, first time</option><option value="partly">With some trouble</option><option value="no">No, it didn't work</option></select></label>
    <label class="field"><span>What worked well?</span><textarea class="input" name="good" rows="3"></textarea></label>
    <label class="field"><span>What went wrong or was confusing?</span><textarea class="input" name="problems" rows="3" placeholder="Steps help us fix it: what you clicked, what happened."></textarea></label>
    <label class="field"><span>What's missing for your Sundays?</span><textarea class="input" name="missing" rows="3"></textarea></label>
    <label class="field"><span>Would you recommend it to another church?</span><select class="input" name="recommend"><option value="">Choose…</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">Not yet</option></select></label>
    <button class="btn btn-gold" type="submit">Send feedback</button></form>`;
  document.body.append(dlg);
  const vals = {};
  dlg.querySelectorAll(".stars").forEach((row) => row.addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    vals[row.dataset.name] = Number(b.dataset.v);
    row.querySelectorAll("button").forEach((x) => x.classList.toggle("on", Number(x.dataset.v) <= vals[row.dataset.name]));
  }));
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
  const f = dlg.querySelector("form");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!vals.overall) return toast("Tap a star rating first.");
    try {
      await api("/api/presenter/feedback", { method: "POST", body: { source: "web", overall: vals.overall, ease: vals.ease, install_ok: f.install_ok.value, good: f.good.value, problems: f.problems.value, missing: f.missing.value, recommend: f.recommend.value } });
      dlg.close(); toast("Thank you! Your feedback reached the team.");
    } catch (err) { toast(err.message); }
  });
  dlg.showModal();
}

whenSignedIn(() => load());
const msg = new URLSearchParams(location.search).get("msg");
if (msg && MSG[msg]) toast(MSG[msg], 5000);
load().catch(() => { card.innerHTML = `<p>We couldn't load the beta right now. Please refresh the page.</p>`; });
