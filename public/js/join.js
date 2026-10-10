import { functionalAllowed } from "./consent.js";
import { icon } from "./icons.js";
import { AVAILABILITY, LABELS, MINISTRIES } from "./options.js";
import { api, esc } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { switchReady } from "./switcher.js";

const form = document.getElementById("join-form");
const steps = [...form.querySelectorAll(".step")];
const stepList = document.getElementById("steps");
const backBtn = document.getElementById("back");
const nextBtn = document.getElementById("next");
const DRAFT_KEY = "sccy-join-draft-v1";
const MAX_MB = 10;
let current = 0;

// ---------- build option controls ----------
const chip = (type, name, value, label) =>
  `<label class="chip"><input type="${type}" name="${name}" value="${esc(value)}"><span>${esc(label)}</span></label>`;
const fillChips = (id, type, name, entries) => { document.getElementById(id).innerHTML = entries.map(([v, l]) => chip(type, name, v, l)).join(""); };

fillChips("occupation-chips", "radio", "occupation_status", Object.entries(LABELS.occupation_status));
fillChips("salvation-chips", "radio", "salvation_status", Object.entries(LABELS.salvation_status));
fillChips("water-chips", "radio", "water_baptised", Object.entries(LABELS.yes_no_want));
fillChips("spirit-chips", "radio", "spirit_baptised", Object.entries(LABELS.yes_no_want));
fillChips("interest-chips", "checkbox", "interests", MINISTRIES.map((m) => [m.slug, m.label]));
fillChips("availability-chips", "checkbox", "availability", AVAILABILITY);
const addOptions = (sel, entries) => sel.insertAdjacentHTML("beforeend", entries.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""));
addOptions(form.gender, Object.entries(LABELS.gender));
addOptions(form.heard_about, Object.entries(LABELS.heard_about));

stepList.innerHTML = steps.map((s) => `<li><span class="bulb"></span>${esc(s.dataset.step)}</li>`).join("");

// ---------- files ----------
const files = { photo: [], documents: [] };
const limits = { photo: 1, documents: 3 };

function renderFiles(name) {
  const list = form.querySelector(`[data-drop="${name}"] .file-list`);
  list.innerHTML = files[name].map((f, i) => {
    const thumb = f.type.startsWith("image/") && f.type !== "image/heic" ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>`;
    return `<div class="file-item">${thumb}<span class="name">${esc(f.name)}</span><span class="hint">${(f.size / 1048576).toFixed(1)} MB</span><button type="button" data-remove="${name}:${i}" aria-label="Remove ${esc(f.name)}">✕</button></div>`;
  }).join("");
}

function addFiles(name, list) {
  const field = form.querySelector(`[data-drop="${name}"]`).closest(".field");
  field.classList.remove("invalid");
  for (const f of list) {
    if (f.size > MAX_MB * 1048576) { setError(field, `"${f.name}" is over ${MAX_MB} MB.`); continue; }
    if (name === "photo") files.photo = [f];
    else if (files.documents.length < limits.documents) files.documents.push(f);
    else { setError(field, `You can attach up to ${limits.documents} documents.`); break; }
  }
  renderFiles(name);
}

form.querySelectorAll("[data-drop]").forEach((drop) => {
  const name = drop.dataset.drop;
  const input = drop.querySelector("input");
  input.addEventListener("change", () => { addFiles(name, input.files); input.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); addFiles(name, e.dataTransfer.files); });
  drop.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    e.preventDefault();
    const [n, i] = rm.dataset.remove.split(":");
    files[n].splice(Number(i), 1);
    renderFiles(n);
  });
});

// ---------- conditional fields ----------
function age() {
  const v = form.date_of_birth.value;
  if (!v) return null;
  const d = new Date(v + "T00:00:00"), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
function syncConditional() {
  const minor = (age() ?? 99) < 18;
  document.getElementById("guardian-block").hidden = !minor;
  document.getElementById("whatsapp-field").hidden = form.whatsapp_same.checked;
  const transfer = form.membership_type.value === "transfer";
  document.getElementById("prev-label").classList.toggle("req", transfer);
  document.getElementById("prev-label").textContent = transfer ? "Church you're transferring from" : "Previous church";
  document.getElementById("salvation-year-field").hidden = form.salvation_status.value !== "saved";
  const occ = form.occupation_status.value;
  document.getElementById("institution-label").textContent =
    occ === "school" ? "School" : occ === "university" ? "University / college" : occ === "working" ? "Employer" : "School / university / employer";
  document.getElementById("grade-label").textContent =
    occ === "school" ? "Grade" : occ === "university" ? "Course & year" : occ === "working" ? "Job title" : "Grade, course or job title";
}
form.addEventListener("change", syncConditional);
form.addEventListener("input", (e) => { if (e.target.name === "date_of_birth") syncConditional(); });

// ---------- validation ----------
function setError(field, msg) { field.classList.add("invalid"); const e = field.querySelector(".error"); if (e) e.textContent = msg; }
function fieldOf(name) { const el = form.querySelector(`[name="${name}"]`); return el?.closest(".field") || form.querySelector(`[data-field="${name}"]`); }

function validateStep(i) {
  const s = steps[i];
  s.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
  const errs = [];
  const need = (name, msg) => { const el = form.elements[name]; const v = el instanceof RadioNodeList ? el.value : el?.type === "checkbox" ? el.checked : el?.value.trim(); if (!v) errs.push([name, msg]); };
  const name = s.dataset.step;
  if (name === "Your path") need("membership_type", "Please choose one option.");
  if (name === "About you") {
    need("first_name", "First name is required."); need("last_name", "Surname is required.");
    need("date_of_birth", "Date of birth is required.");
    const a = age(); if (a !== null && (a < 10 || a > 100)) errs.push(["date_of_birth", "Please check your date of birth."]);
    need("phone", "Mobile number is required.");
    if (form.phone.value && form.phone.value.replace(/\D/g, "").length < 9) errs.push(["phone", "Please enter a valid number."]);
    need("email", "Email is required.");
    if (form.email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim())) errs.push(["email", "Please enter a valid email."]);
  }
  if (name === "Faith journey" && form.membership_type.value === "transfer") need("previous_church", "Please tell us which church you're transferring from.");
  if (name === "Care & consent") {
    need("emergency_name", "Required."); need("emergency_relationship", "Required."); need("emergency_phone", "Required.");
    if ((age() ?? 99) < 18) { need("guardian_name", "Required for under-18s."); need("guardian_phone", "Required for under-18s."); need("guardian_consent", "Parent/guardian consent is required."); }
    need("popia_consent", "We need your consent to store your details.");
    need("signature_name", "Please type your full name.");
  }
  for (const [n, msg] of errs) { const f = fieldOf(n); if (f) setError(f, msg); }
  if (errs.length) {
    const first = fieldOf(errs[0][0]);
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    first?.querySelector("input, select, textarea")?.focus({ preventScroll: true });
  }
  return !errs.length;
}

// ---------- review ----------
const label = (group, v) => (LABELS[group] && LABELS[group][v]) || v || "—";
function renderReview() {
  const fd = new FormData(form);
  const g = (k) => (fd.get(k) || "").toString().trim();
  const all = (k) => fd.getAll(k);
  const rows = (pairs) => `<dl>${pairs.filter(([, v]) => v !== null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}</dl>`;
  const group = (title, step, html) => `<div class="group"><header><b>${title}</b><button type="button" data-goto="${step}">Edit</button></header>${html}</div>`;
  const minor = (age() ?? 99) < 18;
  document.getElementById("review").innerHTML = [
    group("Path", 0, rows([["Joining as", label("membership_type", g("membership_type"))]])),
    group("About you", 1, rows([["Name", `${g("first_name")} ${g("last_name")}${g("preferred_name") ? ` (${g("preferred_name")})` : ""}`], ["Date of birth", g("date_of_birth")], ["Gender", label("gender", g("gender"))], ["Mobile", g("phone")], ["WhatsApp", form.whatsapp_same.checked ? "Same as mobile" : g("whatsapp")], ["Email", g("email")]])),
    group("Where you're at", 2, rows([["Area", [g("suburb"), g("city")].filter(Boolean).join(", ")], ["Currently", label("occupation_status", g("occupation_status"))], ["Institution", [g("institution"), g("grade_or_role")].filter(Boolean).join(" · ")]])),
    group("Faith journey", 3, rows([["Saved", label("salvation_status", g("salvation_status"))], ["Water baptism", label("yes_no_want", g("water_baptised"))], ["Holy Spirit baptism", label("yes_no_want", g("spirit_baptised"))], ["Previous church", g("previous_church")], ["Heard about us", label("heard_about", g("heard_about"))]])),
    group("Get involved", 4, rows([["Interests", all("interests").map((s) => MINISTRIES.find((m) => m.slug === s)?.label).join(", ")], ["Availability", all("availability").map((s) => AVAILABILITY.find((a) => a[0] === s)?.[1]).join(", ")], ["Skills", g("skills")]])),
    group("Care & consent", 5, rows([["Emergency contact", `${g("emergency_name")} (${g("emergency_relationship")}) · ${g("emergency_phone")}`], ["Guardian", minor ? `${g("guardian_name")} · ${g("guardian_phone")}` : null], ["Uploads", [...files.photo, ...files.documents].map((f) => f.name).join(", ") || "None"], ["Contact via", ["comm_whatsapp", "comm_email", "comm_sms"].filter((k) => form[k].checked).map((k) => k.replace("comm_", "")).join(", ")], ["Signed", g("signature_name")]])),
  ].join("");
}
document.getElementById("review").addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) go(Number(b.dataset.goto)); });

// ---------- navigation ----------
function go(i) {
  current = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, k) => s.classList.toggle("active", k === current));
  [...stepList.children].forEach((li, k) => { li.classList.toggle("done", k < current); li.classList.toggle("current", k === current); });
  backBtn.style.visibility = current === 0 ? "hidden" : "visible";
  const last = current === steps.length - 1;
  nextBtn.innerHTML = last ? "Submit &amp; join the family ✦" : `Continue ${icon("arrowRight", "arr")}`;
  if (last) renderReview();
  document.querySelector(".join-card").scrollIntoView({ behavior: "smooth", block: "start" });
  saveDraft();
}
backBtn.addEventListener("click", () => go(current - 1));
nextBtn.addEventListener("click", () => {
  if (current < steps.length - 1) { if (validateStep(current)) go(current + 1); }
  else submit();
});
form.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") { e.preventDefault(); nextBtn.click(); }
});
form.addEventListener("submit", (e) => e.preventDefault());

// Signature follows the name you typed (until you change it yourself), so nobody types their name twice.
let autoSig = "";
["first_name", "last_name"].forEach((k) => form[k]?.addEventListener("input", () => {
  const full = `${form.first_name.value.trim()} ${form.last_name.value.trim()}`.trim();
  if (!form.signature_name.value || form.signature_name.value === autoSig) { form.signature_name.value = full; autoSig = full; }
}));

// ---------- drafts (this device only) ----------
const saveState = document.getElementById("save-state");
function saveDraft() {
  try {
    const data = {};
    for (const el of form.elements) {
      if (!el.name || el.type === "file" || el.name === "website") continue;
      if (el.type === "checkbox") { (data[el.name] ??= []); if (el.checked) data[el.name].push(el.value === "on" ? true : el.value); }
      else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    }
    data.__step = current;
    if (!functionalAllowed()) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    saveState.textContent = "Draft saved";
  } catch { /* storage unavailable */ }
}
function loadDraft() {
  let data;
  try { data = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return 0; }
  if (!data) return 0;
  for (const el of form.elements) {
    if (!el.name || !(el.name in data) || el.type === "file") continue;
    const v = data[el.name];
    if (el.type === "checkbox") el.checked = Array.isArray(v) && (v.includes(true) || v.includes(el.value));
    else if (el.type === "radio") el.checked = el.value === v;
    else el.value = v;
  }
  return Math.min(Number(data.__step) || 0, steps.length - 1);
}
let saveTimer;
form.addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); });
form.addEventListener("change", () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 300); });

// ---------- submit ----------
const STEP_OF_FIELD = {};
steps.forEach((s, i) => s.querySelectorAll("[name]").forEach((el) => { STEP_OF_FIELD[el.name] = i; }));

async function submit() {
  for (let i = 0; i < steps.length - 1; i++) if (!validateStep(i)) { go(i); validateStep(i); return; }
  const errBox = document.getElementById("submit-error");
  errBox.hidden = true;
  const fd = new FormData();
  for (const el of form.elements) {
    if (!el.name || el.type === "file") continue;
    if (el.type === "checkbox") { if (el.checked) fd.append(el.name, el.value === "on" ? "1" : el.value); }
    else if (el.type === "radio") { if (el.checked) fd.append(el.name, el.value); }
    else if (el.value) fd.append(el.name, el.value);
  }
  files.photo.forEach((f) => fd.append("photo", f, f.name));
  files.documents.forEach((f) => fd.append("documents", f, f.name));

  nextBtn.disabled = true; backBtn.disabled = true;
  nextBtn.textContent = "Sending…";
  try {
    const res = await api("/api/join", { method: "POST", form: fd });
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    form.hidden = true;
    stepList.querySelectorAll("li").forEach((li) => { li.className = "done"; });
    const ok = document.getElementById("success");
    ok.hidden = false;
    document.getElementById("success-title").textContent = res.already ? `${res.first_name}, you're already part of the family!` : `Welcome to the family, ${res.first_name || "friend"}.`;
    document.getElementById("success-ref").textContent = res.ref;
    saveState.textContent = "";
    ok.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!res.already) import("./welcome.js").then(({ showWelcome }) => showWelcome({
      title: `to the family, ${res.first_name || "friend"}`,
      line: "A leader will reach out personally within the week. We've emailed you a copy of your welcome.",
      actions: [{ label: "See what's coming up", href: "/events" }],
    }));
  } catch (err) {
    const details = err.details || {};
    const names = Object.keys(details);
    if (names.length) {
      const firstStep = Math.min(...names.map((n) => STEP_OF_FIELD[n] ?? steps.length - 1));
      go(firstStep);
      for (const n of names) { const f = fieldOf(n); if (f) setError(f, details[n]); }
    } else {
      errBox.textContent = err.message; errBox.hidden = false;
    }
  } finally {
    nextBtn.disabled = false; backBtn.disabled = false;
    if (current === steps.length - 1) nextBtn.innerHTML = "Submit &amp; join the family ✦";
  }
}

// ---------- Google: prefill & smart redirects ----------
function applyAccount(me) {
  if (!me?.user) return false;
  if (me.admin_account) { location.href = "/admin/"; return true; } // the admin never needs onboarding
  if (me.member) {
    form.hidden = true;
    const ok = document.getElementById("success");
    ok.hidden = false;
    document.getElementById("success-title").textContent = `${me.user.given_name || "Friend"}, you're already part of the family!`;
    document.getElementById("success-ref").textContent = me.member.ref_code;
    return true;
  }
  const u = me.user;
  if (!form.first_name.value && u.given_name) form.first_name.value = u.given_name;
  if (!form.last_name.value && u.family_name) form.last_name.value = u.family_name;
  form.email.value = u.email;
  form.email.readOnly = true;
  form.signature_name.value ||= u.name || "";
  document.getElementById("google-join").hidden = true;
  const s = document.getElementById("signed-in-as");
  s.hidden = false;
  s.textContent = `Signed in as ${u.email} — we've filled in what we can.`;
  saveDraft();
  return true;
}
getMe().then(async (me) => {
  if (applyAccount(me)) { switchReady(); return; }
  switchReady();
  const shown = await googleButton(document.getElementById("join-google"), { text: "signup_with" });
  document.getElementById("google-join").hidden = !shown;
});
whenSignedIn(applyAccount);

// ---------- init ----------
const startStep = loadDraft();
const params = new URLSearchParams(location.search);
const interest = params.get("interest");
if (interest) form.querySelectorAll(`[name="interests"][value="${CSS.escape(interest)}"]`).forEach((c) => { c.checked = true; });
const type = params.get("type");
if (type) form.querySelectorAll(`[name="membership_type"][value="${CSS.escape(type)}"]`).forEach((c) => { c.checked = true; });
syncConditional();
go(startStep);
window.scrollTo(0, 0);
