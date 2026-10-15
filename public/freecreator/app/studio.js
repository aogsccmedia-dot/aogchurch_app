// FreeCreator Studio (online): cameras / HDMI / ATEM-over-USB inputs, scenes, animated lower thirds, the song words
// from FreeCreator, background music, recording and live streaming (WHIP), all in the browser.
// Built for speed: one canvas compositor on a steady timer, overlay layers cached and only redrawn when they change.
const me = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
if (!me?.user) { location.replace("/freecreator?signin=1"); await new Promise(() => {}); }
if (matchMedia("(pointer: coarse) and (max-width: 900px)").matches) { location.replace("/freecreator/app/camera.html"); await new Promise(() => {}); }
// Strictly for members of a church workspace; everything here is that church's own (nothing is shared between churches).
const acc = await fetch("/api/freecreator/access", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
if (!acc?.church) { location.replace("/freecreator?nochurch=1"); await new Promise(() => {}); }
const CHURCH = acc.church;
const $ = (id) => document.getElementById(id);
const KEY = `freecreator:${CHURCH.id}:${me.user.id}:studio`;
const store = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* full */ } };
const H = { "Content-Type": "application/json", "x-scc-admin": "1" };
const SANS = "Jost, Inter, 'Segoe UI', Arial, sans-serif";
const QUALITY = { "720p30": { w: 1280, h: 720, fps: 30, kbps: 3000 }, "1080p30": { w: 1920, h: 1080, fps: 30, kbps: 5000 }, "1080p60": { w: 1920, h: 1080, fps: 60, kbps: 7500 } };
const toastBox = document.createElement("div"); toastBox.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99;display:grid;gap:6px";
document.body.append(toastBox);
const toast = (m) => { const t = document.createElement("div"); t.textContent = m; t.style.cssText = "padding:10px 14px;border-radius:10px;background:#24242f;border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.4)"; toastBox.append(t); setTimeout(() => t.remove(), 4200); };

// ---------------------------------------------------------------- state
const S = {
  q: QUALITY[store.quality] || QUALITY["1080p30"], scene: store.scene || "camwords",
  words: "", reference: "", wordsOn: store.wordsOn !== false, logoOn: !!store.logoOn, fade: 0, fadeTarget: 0,
  l3: store.l3 || [{ name: "Our pastor", title: "Senior Pastor" }, { name: "Welcome home", title: CHURCH.name }],
  l3Style: store.l3Style || "bar", l3Color: store.l3Color || "#d6a650", l3Auto: Number(store.l3Auto ?? 10), l3Active: -1, l3Shown: false, l3Anim: 0, l3At: 0,
  bgImg: null,
  logoCorner: store.logoCorner || "tr", logoSize: Number(store.logoSize ?? 0.09), logoOpacity: Number(store.logoOpacity ?? 0.9),
  scrStyle: store.scrStyle || "card", hold: false, autoHold: store.autoHold !== false, holdMsg: store.holdMsg || "We'll be right back",
  holdSub: store.holdSub || "Stay with us — the service continues in a moment.", holdAt: 0,
  timer: { on: false, end: 0, mode: store.timerMode || "corner", label: store.timerLabel || "Service starts in", then: store.timerThen || "cam" },
};
const SCENES = [
  ["cam", "Camera", "Camera A, full"], ["camwords", "Camera + words", "Song words as a lower band"], ["slides", "Slides", "Words on a background"],
  ["pip", "Two cameras", "Camera B in the corner"], ["slidescam", "Slides + camera", "Speaker in the corner"], ["screen", "Screen share", "With camera in the corner"],
  ["hold", "Holding screen", "“We'll be right back”"],
];
const SERIF = "Georgia, 'Times New Roman', serif";

// ---------------------------------------------------------------- inputs
const vid = (name) => { const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.dataset.name = name; return v; };
const V = { a: vid("a"), b: vid("b"), screen: vid("screen") };
const streams = { a: null, b: null, screen: null, mic: null };
async function listDevices() {
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true })); s?.getTracks().forEach((t) => t.stop()); } catch { /* no permission */ }
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const cams = all.filter((d) => d.kind === "videoinput"), mics = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications");
  const label = (d, i, k) => `${d.label || `${k} ${i + 1}`}${KIND[kindOf(d)] ? ` · ${KIND[kindOf(d)]}` : ""}`;
  const fill = (sel, list, k, saved) => { sel.innerHTML = `<option value="">None</option>` + list.map((d, i) => `<option value="${d.deviceId}">${label(d, i, k).replace(/</g, "")}</option>`).join(""); if (saved && list.some((d) => d.deviceId === saved)) sel.value = saved; };
  // An ATEM (or HDMI capture) is the main camera unless someone chose otherwise.
  const atem = cams.find((d) => kindOf(d) === "atem") || cams.find((d) => kindOf(d) === "hdmi");
  const firstA = store.camA && cams.some((d) => d.deviceId === store.camA) ? store.camA : (atem || cams[0])?.deviceId;
  fill($("srcA"), cams, "Camera", firstA); fill($("srcB"), cams, "Camera", store.camB); fill($("srcMic"), mics, "Microphone", store.mic ?? mics[0]?.deviceId);
  const fresh = cams.filter((d) => known.size && !known.has(d.deviceId));
  for (const d of fresh) toast(`New source found: ${label(d, 0, "Camera")}`);
  if (fresh.length && atem && fresh.includes(atem) && $("srcA").value !== atem.deviceId) { $("srcA").value = atem.deviceId; store.camA = atem.deviceId; persist(); useCam("a", atem.deviceId); toast("ATEM switched in as camera A"); }
  known = new Set(cams.map((d) => d.deviceId));
  S.cams = cams.map((d, i) => ({ id: d.deviceId, name: d.label || `Camera ${i + 1}`, kind: kindOf(d) }));
  addPhoneOptions(); drawSources();
}
const KIND = { atem: "ATEM", hdmi: "HDMI", usb: "USB camera", builtin: "Built-in" };
const kindOf = (d) => /blackmagic|atem/i.test(d.label) ? "atem" : /capture|hdmi|elgato|cam link|magewell|avermedia|usb video|ezcap|uvc/i.test(d.label) ? "hdmi" : /facetime|integrated|built-in|internal/i.test(d.label) ? "builtin" : d.label ? "usb" : "";
let known = new Set();
function drawSources() {
  const list = [...(S.cams || []).map((c) => ({ ...c, value: c.id })), ...[...phones.entries()].map(([id, p]) => ({ name: p.label, kind: "phone", value: `phone:${id}` }))];
  $("srcList").innerHTML = list.length ? list.map((c) => `<div class="st-src${$("srcA").value === c.value ? " a" : ""}${$("srcB").value === c.value ? " b" : ""}"><span class="st-src-k ${c.kind}">${{ atem: "ATEM", hdmi: "HDMI", usb: "USB", builtin: "Built-in", phone: "Phone" }[c.kind] || "Camera"}</span><span class="st-src-n">${c.name.replace(/</g, "")}</span><button class="st-btn" data-to="a" data-v="${c.value}">A</button><button class="st-btn" data-to="b" data-v="${c.value}">B</button></div>`).join("")
    : `<p class="st-hint">No cameras found yet. Plug in a camera, capture card or ATEM, then allow camera access.</p>`;
}
navigator.mediaDevices?.addEventListener?.("devicechange", () => { clearTimeout(drawSources.t); drawSources.t = setTimeout(listDevices, 700); });
// ---- Phones as cameras (WebRTC straight from the phone; the server only passes the connection details)
const phones = new Map();
function addPhoneOptions() {
  for (const sel of [$("srcA"), $("srcB")]) {
    sel.querySelectorAll("option[data-phone]").forEach((o) => o.remove());
    for (const [id, ph] of phones) sel.insertAdjacentHTML("beforeend", `<option data-phone value="phone:${id}">📱 ${ph.label.replace(/</g, "")}</option>`);
  }
  if (S.cams) drawSources();
  $("phoneList").innerHTML = [...phones.values()].map((ph) => `<div class="st-track playing"><span>📱 ${ph.label.replace(/</g, "")}</span><small>${ph.pc.connectionState}</small></div>`).join("");
}
let room = null, roomTimer = 0;
$("phoneAdd").onclick = async () => {
  if (!room) {
    const r = await fetch("/api/freecreator/cam/room", { method: "POST", headers: H, credentials: "same-origin", body: "{}" }).then((x) => x.json()).catch(() => null);
    if (!r?.code) return toast("Couldn't open a phone code. Try again.");
    room = r.code; $("phoneCode").textContent = room; $("phoneCode").hidden = false; $("phoneAdd").textContent = "Waiting for phones…";
    clearInterval(roomTimer); roomTimer = setInterval(checkPhones, 1500);
  }
};
async function checkPhones() {
  const r = await fetch(`/api/freecreator/cam/pending?code=${room}`, { credentials: "same-origin", cache: "no-store" }).then((x) => x.json()).catch(() => null);
  for (const l of r?.links || []) {
    if (phones.has(l.id)) continue;
    const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle", iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    const ph = { label: l.label || "Phone", pc, stream: new MediaStream() };
    phones.set(l.id, ph);
    pc.ontrack = (e) => {
      ph.stream.addTrack(e.track);
      if (e.track.kind === "audio") { const src = AC.createMediaStreamSource(new MediaStream([e.track])), g = AC.createGain(); g.gain.value = 1; src.connect(g); g.connect(mix); g.connect(meter); ph.audio = g; }
      addPhoneOptions();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") toast(`${ph.label} connected`); if (pc.connectionState === "failed" || pc.connectionState === "closed") { phones.delete(l.id); addPhoneOptions(); } else addPhoneOptions(); };
    await pc.setRemoteDescription({ type: "offer", sdp: l.offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await new Promise((res) => { if (pc.iceGatheringState === "complete") res(); pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && res()); setTimeout(res, 3000); });
    await fetch("/api/freecreator/cam/answer", { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify({ code: room, id: l.id, sdp: pc.localDescription.sdp }) }).catch(() => {});
    addPhoneOptions();
  }
}
async function useCam(slot, deviceId) {
  if (!String(streams[slot]?.id || "").startsWith("phone")) streams[slot]?.getTracks().forEach((t) => { if (![...phones.values()].some((p) => p.stream.getTracks().includes(t))) t.stop(); });
  streams[slot] = null; V[slot].srcObject = null;
  if (!deviceId) return;
  if (deviceId.startsWith("phone:")) { const ph = phones.get(deviceId.slice(6)); if (!ph) return; V[slot].srcObject = new MediaStream(ph.stream.getVideoTracks()); await V[slot].play().catch(() => {}); return; }
  try {
    streams[slot] = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: S.q.w }, height: { ideal: S.q.h }, frameRate: { ideal: S.q.fps } }, audio: false });
    V[slot].srcObject = streams[slot]; await V[slot].play().catch(() => {});
  } catch (e) { toast(`Couldn't open that camera: ${e.message}`); }
}
async function shareScreen() {
  try {
    streams.screen?.getTracks().forEach((t) => t.stop());
    streams.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: S.q.fps }, audio: false });
    V.screen.srcObject = streams.screen; await V.screen.play().catch(() => {});
    streams.screen.getVideoTracks()[0].addEventListener("ended", () => { streams.screen = null; V.screen.srcObject = null; });
    setScene("screen");
  } catch { /* cancelled */ }
}

// ---------------------------------------------------------------- audio mix (mic + music → stream)
const AC = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
const mix = AC.createMediaStreamDestination();
const micGain = AC.createGain(), musicGain = AC.createGain(), meter = AC.createAnalyser(), monitorGain = AC.createGain();
meter.fftSize = 512; monitorGain.gain.value = 0;
micGain.connect(mix); micGain.connect(meter); musicGain.connect(mix);
micGain.connect(monitorGain); musicGain.connect(monitorGain); monitorGain.connect(AC.destination);
musicGain.gain.value = (store.musicVol ?? 45) / 100;
let micNode = null;
async function useMic(deviceId) {
  micNode?.disconnect(); streams.mic?.getTracks().forEach((t) => t.stop()); streams.mic = null;
  if (!deviceId) return;
  try {
    streams.mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 } });
    micNode = AC.createMediaStreamSource(streams.mic); micNode.connect(micGain);
  } catch (e) { toast(`Couldn't open that microphone: ${e.message}`); }
}
const meterBuf = new Uint8Array(meter.fftSize);
setInterval(() => { meter.getByteTimeDomainData(meterBuf); let peak = 0; for (const v of meterBuf) peak = Math.max(peak, Math.abs(v - 128)); $("micMeter").style.width = `${Math.min(100, (peak / 128) * 140)}%`; }, 80);
// Music
const tracks = [];
let playing = null;
function fadeTo(g, v, sec = 1.5) { const t = AC.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + sec); }
function drawMusic() {
  $("musicList").innerHTML = tracks.length ? tracks.map((t, i) => `<div class="st-track${playing === i ? " playing" : ""}"><span>${t.name.replace(/</g, "")}</span><button class="st-btn" data-play="${i}">${playing === i ? "Fade out" : "Play"}</button></div>`).join("") : `<p class="st-hint">Add MP3 or WAV files from this computer. They play into the stream and fade in and out smoothly.</p>`;
}
$("musicAdd").onclick = () => { const i = document.createElement("input"); i.type = "file"; i.accept = "audio/*"; i.multiple = true; i.onchange = () => { for (const f of i.files) { const a = new Audio(URL.createObjectURL(f)); a.loop = true; const g = AC.createGain(); g.gain.value = 0; AC.createMediaElementSource(a).connect(g); g.connect(musicGain); tracks.push({ name: f.name.replace(/\.[^.]+$/, ""), a, g }); } drawMusic(); }; i.click(); };
$("musicList").onclick = async (e) => {
  const b = e.target.closest("[data-play]"); if (!b) return; await AC.resume();
  const i = Number(b.dataset.play), t = tracks[i];
  if (playing === i) { fadeTo(t.g, 0, 2); setTimeout(() => { if (playing !== i) t.a.pause(); }, 2100); playing = null; }
  else { if (playing !== null) { const o = tracks[playing]; fadeTo(o.g, 0, 1.5); setTimeout(() => o.a.pause(), 1600); } t.a.play(); fadeTo(t.g, 1, 1.5); playing = i; }
  drawMusic();
};
$("musicVol").value = store.musicVol ?? 45;
$("musicVol").oninput = (e) => { musicGain.gain.value = e.target.value / 100; store.musicVol = Number(e.target.value); persist(); };
$("micVol").oninput = (e) => { micGain.gain.value = e.target.value / 100; };
$("monitor").onchange = (e) => { AC.resume(); monitorGain.gain.value = e.target.checked ? 1 : 0; };

// ---------------------------------------------------------------- song words from FreeCreator (control window)
const bus = new BroadcastChannel("freecreator-live");
bus.onmessage = (e) => {
  if (e.data?.type !== "state") return;
  const s = e.data.state || {}, sl = s.slide || {};
  const text = s.blackout || s.clear ? "" : String(sl.text || "");
  const ref = s.blackout || s.clear ? "" : String(sl.reference || sl.ref || "");
  if (text !== S.words || ref !== S.reference) { S.words = text; S.reference = ref; wordsLayer.dirty = true; }
};
bus.postMessage({ type: "hello" });

// ---------------------------------------------------------------- compositor
const canvas = $("stCanvas"), ctx = canvas.getContext("2d", { alpha: false });
const layer = () => { const c = document.createElement("canvas"); return { c, x: c.getContext("2d"), dirty: true }; };
const wordsLayer = layer(), l3Layer = layer();
let logo = null;
// Each church's own logo (uploaded in Look). Sandton City Church starts with its logo; other churches add theirs.
function loadLogo() { logo = null; const src = store.logoData || (CHURCH.id === "scc" ? "/assets/logo-192.png" : ""); if (!src) return; const i = new Image(); i.onload = () => { logo = i; }; i.src = src; }
loadLogo();
/** Wraps text into lines that fit maxW at the current font. */
function wrap(x, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) { const t = line ? `${line} ${w}` : w; if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
  }
  return out;
}
/** Biggest font size (stepping down) at which the wrapped text fits the box. */
function fit(x, text, font, start, maxW, maxH, lh = 1.25, min = 18) {
  let size = start, lines;
  for (;;) { x.font = font(size); lines = wrap(x, text, maxW); if (size <= min || lines.length * size * lh <= maxH) break; size -= 2; }
  return { size, lines };
}
function cover(v, x, y, w, h) {
  const vw = v.videoWidth || v.width, vh = v.videoHeight || v.height; if (!vw) return false;
  const k = Math.max(w / vw, h / vh); ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(v, x + (w - vw * k) / 2, y + (h - vh * k) / 2, vw * k, vh * k); ctx.restore(); return true;
}
const ready = (v) => v.readyState >= 2 && v.videoWidth > 0;
function placeholder(text) { const W = canvas.width, Hh = canvas.height; ctx.fillStyle = "#101016"; ctx.fillRect(0, 0, W, Hh); ctx.fillStyle = "#555"; ctx.font = `600 ${Hh * 0.035}px ${SANS}`; ctx.textAlign = "center"; ctx.fillText(text, W / 2, Hh / 2); ctx.textAlign = "left"; }
function slideBg() {
  const W = canvas.width, Hh = canvas.height;
  if (S.bgImg) { cover(S.bgImg, 0, 0, W, Hh); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, Hh); return; }
  const g = ctx.createLinearGradient(0, 0, W, Hh); g.addColorStop(0, "#14102c"); g.addColorStop(1, "#3b2a8a"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
}
function pip(v, corner = "br", scale = 0.28) {
  const W = canvas.width, Hh = canvas.height, w = W * scale, h = w * 9 / 16, m = W * 0.025;
  const x = corner.includes("r") ? W - w - m : m, y = corner.includes("b") ? Hh - h - m - (S.l3Shown ? Hh * 0.14 : 0) : m;
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 30; ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 4, w + 8, h + 8); ctx.restore();
  if (!cover(v, x, y, w, h)) { ctx.fillStyle = "#222"; ctx.fillRect(x, y, w, h); }
}
/** The words layer: drawn only when the words, scene or style change. Songs as before; scripture in its own designs. */
function renderWords(full) {
  const W = canvas.width, Hh = canvas.height, L = wordsLayer; L.c.width = W; L.c.height = Hh; L.x.clearRect(0, 0, W, Hh);
  const text = S.words.trim(); if (!text) return;
  if (S.reference) return renderScripture(L.x, W, Hh, text, S.reference, full);
  const lines = text.split("\n").filter(Boolean).slice(0, full ? 8 : 4), x = L.x;
  const bandH = full ? Hh * 0.8 : Hh * 0.26, maxW = W * (full ? 0.86 : 0.8);
  let size = Math.round(Hh * (full ? 0.085 : 0.05));
  const font = (s) => `700 ${s}px ${SANS}`;
  x.font = font(size);
  while (size > 18 && (lines.some((l) => x.measureText(l).width > maxW) || lines.length * size * 1.22 > bandH)) { size -= 2; x.font = font(size); }
  x.textAlign = "center"; x.textBaseline = "middle";
  if (full) {
    x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = size * 0.35; x.fillStyle = "#fff";
    const top = Hh / 2 - ((lines.length - 1) * size * 1.22) / 2;
    lines.forEach((l, i) => x.fillText(l, W / 2, top + i * size * 1.22));
  } else {
    const boxW = Math.min(W * 0.9, Math.max(...lines.map((l) => x.measureText(l).width)) + W * 0.06), boxH = lines.length * size * 1.22 + size * 0.9;
    const bx = (W - boxW) / 2, by = Hh - boxH - Hh * 0.05;
    x.fillStyle = "rgba(0,0,0,.6)"; x.beginPath(); x.roundRect(bx, by, boxW, boxH, Hh * 0.015); x.fill();
    x.fillStyle = "#fff"; lines.forEach((l, i) => x.fillText(l, W / 2, by + size * 0.95 + i * size * 1.22));
  }
}
/** Scripture designs. full = slides scenes (whole screen); otherwise over the camera. */
const SCR_STYLES = { card: "Frosted card", classic: "Classic serif", band: "Lower band", minimal: "Minimal corner", bold: "Bold statement", split: "Split with reference", tag: "Verse tag" };
function renderScripture(x, W, Hh, text, ref, full) {
  const acc = S.l3Color || "#d6a650", st = full && S.scrStyle === "minimal" ? "classic" : S.scrStyle;
  const ink = "#fff", soft = "rgba(255,255,255,.78)";
  x.textBaseline = "alphabetic"; x.shadowColor = "transparent";
  const refFont = (s) => `600 ${s}px ${SANS}`;
  const drawLines = (lines, size, lx, top, align, lh = 1.28) => { x.textAlign = align; lines.forEach((l, i) => x.fillText(l, lx, top + size + i * size * lh)); return top + lines.length * size * lh; };
  if (st === "card") {
    const cw = W * (full ? 0.74 : 0.7), maxH = Hh * (full ? 0.56 : 0.24), pad = W * 0.03;
    const f = fit(x, text, (s) => `500 ${s}px ${SERIF}`, Math.round(Hh * (full ? 0.064 : 0.042)), cw - pad * 2, maxH);
    const rs = Math.round(f.size * 0.6), ch = f.lines.length * f.size * 1.28 + rs * 2.6 + pad * 1.4;
    const cx = (W - cw) / 2, cy = full ? (Hh - ch) / 2 : Hh - ch - Hh * 0.05;
    x.save(); x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 40; x.fillStyle = "rgba(14,14,22,.72)"; x.beginPath(); x.roundRect(cx, cy, cw, ch, Hh * 0.022); x.fill(); x.restore();
    x.strokeStyle = "rgba(255,255,255,.14)"; x.lineWidth = 2; x.beginPath(); x.roundRect(cx, cy, cw, ch, Hh * 0.022); x.stroke();
    x.font = refFont(rs); const rw = x.measureText(ref).width + rs * 1.6;
    x.fillStyle = acc; x.beginPath(); x.roundRect(cx + pad, cy + pad * 0.7, rw, rs * 1.7, rs * 0.85); x.fill();
    x.fillStyle = luma(acc) > 0.55 ? "#111" : "#fff"; x.textAlign = "left"; x.fillText(ref, cx + pad + rs * 0.8, cy + pad * 0.7 + rs * 1.2);
    x.fillStyle = ink; x.font = `500 ${f.size}px ${SERIF}`; drawLines(f.lines, f.size, cx + pad, cy + pad * 0.7 + rs * 2.2, "left");
  } else if (st === "classic") {
    const maxW = W * 0.8, f = fit(x, text, (s) => `400 ${s}px ${SERIF}`, Math.round(Hh * (full ? 0.07 : 0.045)), maxW, Hh * (full ? 0.6 : 0.24));
    const rs = Math.round(f.size * 0.55), total = f.lines.length * f.size * 1.3 + rs * 2.4;
    let top = full ? (Hh - total) / 2 : Hh - total - Hh * 0.07;
    if (!full) { const g = x.createLinearGradient(0, top - Hh * 0.08, 0, Hh); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.78)"); x.fillStyle = g; x.fillRect(0, top - Hh * 0.08, W, Hh - top + Hh * 0.08); }
    x.save(); x.shadowColor = "rgba(0,0,0,.55)"; x.shadowBlur = f.size * 0.3; x.fillStyle = ink; x.font = `italic 400 ${f.size}px ${SERIF}`;
    const end = drawLines(f.lines, f.size, W / 2, top, "center", 1.3); x.restore();
    x.fillStyle = acc; x.fillRect(W / 2 - W * 0.025, end + rs * 0.7, W * 0.05, 3);
    x.font = refFont(rs); x.fillStyle = acc; x.textAlign = "center"; x.fillText(ref.toUpperCase(), W / 2, end + rs * 2.1);
  } else if (st === "band" || (st === "minimal" && !full)) {
    const minimal = st === "minimal", m = W * 0.05, maxW = W * (minimal ? 0.55 : 0.8);
    const f = fit(x, text, (s) => `${minimal ? 500 : 600} ${s}px ${SANS}`, Math.round(Hh * (minimal ? 0.034 : 0.042)), maxW, Hh * (minimal ? 0.22 : 0.22));
    const rs = Math.round(f.size * 0.62), h = f.lines.length * f.size * 1.28 + rs * 2.2 + Hh * 0.035, top = Hh - h - Hh * 0.045;
    if (minimal) { x.save(); x.shadowColor = "rgba(0,0,0,.8)"; x.shadowBlur = 18; }
    else { x.fillStyle = "rgba(10,10,16,.82)"; x.fillRect(0, top, W, h); x.fillStyle = acc; x.fillRect(0, top, W * 0.008, h); }
    x.font = refFont(rs); x.fillStyle = acc; x.textAlign = "left"; x.fillText(ref.toUpperCase(), m, top + Hh * 0.02 + rs);
    x.fillStyle = ink; x.font = `${minimal ? 500 : 600} ${f.size}px ${SANS}`; drawLines(f.lines, f.size, m, top + Hh * 0.02 + rs * 1.5, "left");
    if (minimal) x.restore();
  } else if (st === "bold") {
    const maxW = W * 0.82, f = fit(x, text.toUpperCase(), (s) => `800 ${s}px ${SANS}`, Math.round(Hh * (full ? 0.075 : 0.044)), maxW, Hh * (full ? 0.6 : 0.24), 1.12);
    const rs = Math.round(f.size * 0.5), total = f.lines.length * f.size * 1.12 + rs * 2.2;
    const top = full ? (Hh - total) / 2 : Hh - total - Hh * 0.06, lx = (W - maxW) / 2;
    if (!full) { x.fillStyle = "rgba(0,0,0,.66)"; x.fillRect(0, top - Hh * 0.03, W, total + Hh * 0.06); }
    x.fillStyle = acc; x.fillRect(lx - W * 0.02, top + f.size * 0.15, W * 0.007, f.lines.length * f.size * 1.12);
    x.fillStyle = ink; x.font = `800 ${f.size}px ${SANS}`; const end = drawLines(f.lines, f.size, lx, top, "left", 1.12);
    x.font = refFont(rs); x.fillStyle = acc; x.fillText(`— ${ref}`, lx, end + rs * 1.6);
  } else if (st === "split") {
    const leftW = W * 0.62, m = W * 0.06, h = full ? Hh * 0.7 : Hh * 0.3, top = full ? (Hh - h) / 2 : Hh - h - Hh * 0.04;
    const f = fit(x, text, (s) => `500 ${s}px ${SERIF}`, Math.round(Hh * (full ? 0.062 : 0.038)), leftW - m, h * 0.9);
    if (!full) { x.fillStyle = "rgba(10,10,16,.8)"; x.fillRect(0, top, W, h); }
    x.fillStyle = ink; x.font = `500 ${f.size}px ${SERIF}`; const tTop = top + (h - f.lines.length * f.size * 1.28) / 2 - f.size * 0.2; drawLines(f.lines, f.size, m, tTop, "left");
    x.fillStyle = "rgba(255,255,255,.18)"; x.fillRect(leftW + W * 0.02, top + h * 0.12, 2, h * 0.76);
    const parts = ref.split(/\s(?=\d)/), book = parts[0] || ref, cv = parts.slice(1).join(" ");
    const bs = Math.round(Hh * (full ? 0.05 : 0.032)); x.textAlign = "left";
    x.font = `600 ${bs}px ${SANS}`; x.fillStyle = soft; x.fillText(book, leftW + W * 0.05, top + h / 2 - bs * 0.2);
    x.font = `800 ${bs * 1.9}px ${SANS}`; x.fillStyle = acc; x.fillText(cv, leftW + W * 0.05, top + h / 2 + bs * 1.7);
  } else {   // tag
    const m = W * 0.05, maxW = W * 0.84, f = fit(x, `“${text}”`, (s) => `500 ${s}px ${SANS}`, Math.round(Hh * (full ? 0.06 : 0.04)), maxW, Hh * (full ? 0.6 : 0.22));
    const rs = Math.round(f.size * 0.62), total = f.lines.length * f.size * 1.28 + rs * 2.8;
    const top = full ? (Hh - total) / 2 : Hh - total - Hh * 0.06;
    if (!full) { const g = x.createLinearGradient(0, top - Hh * 0.06, 0, Hh); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.35, "rgba(0,0,0,.7)"); x.fillStyle = g; x.fillRect(0, top - Hh * 0.06, W, Hh); }
    x.font = refFont(rs); const tw = x.measureText(ref).width + rs * 1.4;
    x.fillStyle = "#fff"; x.beginPath(); x.roundRect(m, top, tw, rs * 1.7, 6); x.fill(); x.fillStyle = "#111"; x.textAlign = "left"; x.fillText(ref, m + rs * 0.7, top + rs * 1.22);
    x.save(); x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 16; x.fillStyle = ink; x.font = `500 ${f.size}px ${SANS}`; drawLines(f.lines, f.size, m, top + rs * 2.2, "left"); x.restore();
  }
  x.textAlign = "left";
}
/** The lower third layer (drawn once per change); its slide-in is done with a cheap translate + alpha. */
function renderL3() {
  const W = canvas.width, Hh = canvas.height, L = l3Layer; L.c.width = W; L.c.height = Hh; L.x.clearRect(0, 0, W, Hh);
  const it = S.l3[S.l3Active]; if (!it) return;
  const x = L.x, acc = S.l3Color, style = S.l3Style, m = W * 0.05, baseY = Hh * (S.scene === "camwords" && S.wordsOn ? 0.66 : 0.86);
  const nameS = Math.round(Hh * 0.046), titleS = Math.round(Hh * 0.029);
  x.font = `700 ${nameS}px ${SANS}`; const nw = x.measureText(it.name || "").width; x.font = `500 ${titleS}px ${SANS}`; const tw = x.measureText(it.title || "").width;
  const w = Math.max(nw, tw) + W * 0.05, h = nameS * 1.25 + (it.title ? titleS * 1.5 : 0) + Hh * 0.03;
  x.save();
  if (style === "bar") { x.fillStyle = acc; x.fillRect(m, baseY - h, W * 0.008, h); x.fillStyle = "rgba(10,10,16,.86)"; x.fillRect(m + W * 0.008, baseY - h, w, h); }
  else if (style === "glass") { x.fillStyle = "rgba(255,255,255,.16)"; x.strokeStyle = "rgba(255,255,255,.4)"; x.lineWidth = 2; x.beginPath(); x.roundRect(m, baseY - h, w + W * 0.01, h, Hh * 0.02); x.fill(); x.stroke(); x.fillStyle = acc; x.fillRect(m + W * 0.02, baseY - h * 0.12, W * 0.05, 4); }
  else if (style === "block") { x.fillStyle = acc; x.fillRect(m, baseY - h, w + W * 0.01, nameS * 1.25 + Hh * 0.012); x.fillStyle = "#111"; x.fillRect(m, baseY - h + nameS * 1.25 + Hh * 0.012, w + W * 0.01, h - nameS * 1.25 - Hh * 0.012); }
  else if (style === "pill") { x.fillStyle = "rgba(10,10,16,.85)"; x.beginPath(); x.roundRect(m, baseY - h, w + W * 0.02, h, h / 2); x.fill(); x.fillStyle = acc; x.beginPath(); x.arc(m + h / 2, baseY - h / 2, h * 0.18, 0, 7); x.fill(); }
  else if (style === "gradient") { const g = x.createLinearGradient(m, 0, m + w * 1.6, 0); g.addColorStop(0, acc); g.addColorStop(0.55, "rgba(20,16,44,.85)"); g.addColorStop(1, "rgba(20,16,44,0)"); x.fillStyle = g; x.fillRect(m, baseY - h, w * 1.6, h); }
  else if (style === "ribbon") { const k = h * 0.35; x.fillStyle = acc; x.beginPath(); x.moveTo(m, baseY - h); x.lineTo(m + w + k + W * 0.01, baseY - h); x.lineTo(m + w + W * 0.01, baseY); x.lineTo(m - k, baseY); x.closePath(); x.fill(); x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(m - k, baseY - 5, w + k * 1.5, 5); }
  else if (style === "news") { x.fillStyle = "rgba(10,10,16,.9)"; x.fillRect(0, baseY - h, W, h); x.fillStyle = acc; x.fillRect(0, baseY - h, W, 4); x.fillRect(m - W * 0.02, baseY - h + 4, W * 0.006, h - 4); }
  else if (style === "card") { x.save(); x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 30; x.shadowOffsetY = 8; x.fillStyle = "#fff"; x.beginPath(); x.roundRect(m, baseY - h, w + W * 0.012, h, Hh * 0.014); x.fill(); x.restore(); x.fillStyle = acc; x.beginPath(); x.roundRect(m, baseY - h, W * 0.006, h, [Hh * 0.014, 0, 0, Hh * 0.014]); x.fill(); }
  else if (style === "neon") { x.fillStyle = "rgba(6,6,12,.82)"; x.beginPath(); x.roundRect(m, baseY - h, w + W * 0.012, h, Hh * 0.012); x.fill(); x.save(); x.shadowColor = acc; x.shadowBlur = 22; x.strokeStyle = acc; x.lineWidth = 3; x.beginPath(); x.roundRect(m, baseY - h, w + W * 0.012, h, Hh * 0.012); x.stroke(); x.restore(); }
  else if (style === "split") { const nh = nameS * 1.25 + Hh * 0.012; x.fillStyle = "rgba(255,255,255,.95)"; x.fillRect(m, baseY - h, nw + W * 0.05, nh); if (it.title) { x.fillStyle = acc; x.fillRect(m + W * 0.012, baseY - h + nh, tw + W * 0.04, h - nh); } }
  else { x.fillStyle = acc; x.fillRect(m, baseY + 6, Math.max(nw, tw) + W * 0.02, 4); }
  const ox = m + (style === "pill" ? h * 0.85 : style === "ribbon" ? W * 0.012 : style === "split" ? W * 0.025 : W * 0.025), nameInk = style === "block" || style === "ribbon" ? (luma(acc) > 0.55 ? "#111" : "#fff") : style === "card" || style === "split" ? "#111" : "#fff";
  x.shadowColor = style === "line" ? "rgba(0,0,0,.7)" : "transparent"; x.shadowBlur = style === "line" ? 14 : 0;
  x.fillStyle = nameInk; x.font = `700 ${nameS}px ${SANS}`; x.textBaseline = "alphabetic"; x.fillText(it.name || "", ox, baseY - h + Hh * 0.012 + nameS);
  if (it.title) { x.fillStyle = style === "block" ? "#fff" : style === "card" ? "#555" : style === "ribbon" ? (luma(acc) > 0.55 ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.9)") : style === "split" ? (luma(acc) > 0.55 ? "#111" : "#fff") : "rgba(255,255,255,.82)"; x.font = `500 ${titleS}px ${SANS}`; x.fillText(it.title, ox + (style === "split" ? W * 0.012 : 0), baseY - h + Hh * 0.018 + nameS * 1.25 + titleS); }
  x.restore();
}
/** Holding screen: shown on purpose, or automatically while the internet struggles. Gently moving so viewers know it's live. */
function drawHold(W, Hh) {
  const t = performance.now() / 1000;
  const g = ctx.createLinearGradient(0, 0, W, Hh); g.addColorStop(0, "#0e0b22"); g.addColorStop(1, "#2a1d66"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
  if (S.bgImg) { ctx.globalAlpha = 0.35; cover(S.bgImg, 0, 0, W, Hh); ctx.globalAlpha = 1; }
  for (let i = 0; i < 3; i++) { const r = Hh * (0.35 + i * 0.12), a = t * (0.15 + i * 0.05); ctx.fillStyle = `rgba(214,166,80,${0.05 - i * 0.012})`; ctx.beginPath(); ctx.arc(W / 2 + Math.cos(a) * W * 0.18, Hh / 2 + Math.sin(a * 1.3) * Hh * 0.12, r, 0, 7); ctx.fill(); }
  const s = Hh * 0.16; if (logo) { ctx.save(); ctx.beginPath(); ctx.arc(W / 2, Hh * 0.3, s / 2, 0, 7); ctx.clip(); ctx.drawImage(logo, W / 2 - s / 2, Hh * 0.3 - s / 2, s, s); ctx.restore(); }
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = `700 ${Hh * 0.075}px ${SANS}`; ctx.fillText(S.holdMsg, W / 2, Hh * 0.56);
  ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = `400 ${Hh * 0.034}px ${SANS}`; ctx.fillText(S.holdSub, W / 2, Hh * 0.64);
  const dots = Math.floor(t * 2) % 4; ctx.fillStyle = S.l3Color || "#d6a650"; for (let i = 0; i < 3; i++) { ctx.globalAlpha = i < dots ? 1 : 0.25; ctx.beginPath(); ctx.arc(W / 2 + (i - 1) * Hh * 0.03, Hh * 0.72, Hh * 0.008, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1; ctx.textAlign = "left";
}
function luma(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
let lastSize = "";
function draw() {
  const W = canvas.width, Hh = canvas.height, sc = S.scene, size = `${W}x${Hh}:${sc}`;
  if (size !== lastSize) { lastSize = size; wordsLayer.dirty = true; l3Layer.dirty = true; }
  // Base picture
  if (sc === "hold" || S.hold) { drawHold(W, Hh); return finish(W, Hh); }
  if (S.timer.on && S.timer.mode === "full") { drawCountdown(W, Hh); return finish(W, Hh); }
  if (sc === "slides" || sc === "slidescam") slideBg();
  else if (sc === "screen") { if (!ready(V.screen) || !cover(V.screen, 0, 0, W, Hh)) placeholder("Click “Share a screen or window”"); }
  else if (!ready(V.a) || !cover(V.a, 0, 0, W, Hh)) placeholder("Choose camera A under Inputs");
  if (sc === "pip" && ready(V.b)) pip(V.b, "br");
  if ((sc === "slidescam" || sc === "screen") && ready(V.a)) pip(V.a, sc === "screen" ? "tr" : "br", 0.26);
  // Words
  const showWords = sc === "slides" || sc === "slidescam" || (S.wordsOn && sc === "camwords");
  if (showWords) { if (wordsLayer.dirty) { renderWords(sc === "slides" || sc === "slidescam"); wordsLayer.dirty = false; } ctx.drawImage(wordsLayer.c, 0, 0); }
  // Lower third (animated in and out)
  const target = S.l3Shown ? 1 : 0; S.l3Anim += (target - S.l3Anim) * 0.18; if (Math.abs(target - S.l3Anim) < 0.01) S.l3Anim = target;
  if (S.l3Anim > 0 && S.l3Active >= 0) {
    if (l3Layer.dirty) { renderL3(); l3Layer.dirty = false; }
    const e = 1 - (1 - S.l3Anim) ** 3; ctx.save(); ctx.globalAlpha = e; ctx.translate(-(1 - e) * W * 0.06, 0); ctx.drawImage(l3Layer.c, 0, 0); ctx.restore();
  }
  if (S.l3Shown && S.l3Auto && Date.now() - S.l3At > S.l3Auto * 1000) setL3Shown(false);
  finish(W, Hh);
}
const clockText = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600); return `${h ? h + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`; };
function tickTimer() {
  if (!S.timer.on) return;
  const left = S.timer.end - Date.now();
  $("timerOut").textContent = clockText(left);
  if (left <= 0) { S.timer.on = false; syncTimer(); toast("Timer finished"); if (S.timer.then) setScene(S.timer.then); }
}
function drawCountdown(W, Hh) {
  const g = ctx.createLinearGradient(0, 0, W, Hh); g.addColorStop(0, "#0e0b22"); g.addColorStop(1, "#2a1d66"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
  if (S.bgImg) { ctx.globalAlpha = 0.45; cover(S.bgImg, 0, 0, W, Hh); ctx.globalAlpha = 1; ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, Hh); }
  const left = S.timer.end - Date.now(), total = Math.max(1, S.timer.total || 1), frac = Math.max(0, Math.min(1, left / total));
  ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = `500 ${Hh * 0.042}px ${SANS}`; ctx.fillText(S.timer.label.toUpperCase(), W / 2, Hh * 0.36);
  ctx.fillStyle = "#fff"; ctx.font = `800 ${Hh * 0.2}px ${SANS}`; ctx.fillText(clockText(left), W / 2, Hh * 0.58);
  const bw = W * 0.36, bx = (W - bw) / 2, by = Hh * 0.66; ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.beginPath(); ctx.roundRect(bx, by, bw, Hh * 0.01, Hh * 0.005); ctx.fill();
  ctx.fillStyle = S.l3Color || "#d6a650"; ctx.beginPath(); ctx.roundRect(bx, by, bw * (1 - frac), Hh * 0.01, Hh * 0.005); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = `500 ${Hh * 0.03}px ${SANS}`; ctx.fillText(CHURCH.name, W / 2, Hh * 0.78); ctx.textAlign = "left";
}
/** Last on top of everything: the timer badge, the logo (fixed in its corner, never moves) and the fade. */
function finish(W, Hh) {
  if (S.timer.on && S.timer.mode === "corner") {
    const t = clockText(S.timer.end - Date.now()), fs = Hh * 0.034, m = W * 0.025;
    ctx.font = `700 ${fs}px ${SANS}`; const lw = ctx.measureText(S.timer.label).width, tw = ctx.measureText(t).width, bw = lw + tw + fs * 2.2, bh = fs * 1.9;
    const c = S.logoOn && logo ? (S.logoCorner === "tl" ? "tr" : "tl") : "tl", bx = c === "tl" ? m : W - m - bw, by = m;
    ctx.fillStyle = "rgba(10,10,16,.78)"; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2); ctx.fill();
    ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = `500 ${fs}px ${SANS}`; ctx.fillText(S.timer.label, bx + fs * 0.8, by + bh / 2);
    ctx.fillStyle = S.l3Color || "#d6a650"; ctx.font = `700 ${fs}px ${SANS}`; ctx.fillText(t, bx + fs * 1.4 + lw, by + bh / 2); ctx.textBaseline = "alphabetic";
  }
  if (S.logoOn && logo) {
    const s = Hh * S.logoSize, m = W * 0.025, c = S.logoCorner, ar = (logo.naturalWidth || 1) / (logo.naturalHeight || 1), lw = s * Math.min(ar, 3);
    const lx = Math.round(c.includes("l") ? m : W - m - lw), ly = Math.round(c.includes("t") ? m : Hh - m - s);
    ctx.save(); ctx.globalAlpha = S.logoOpacity;
    if (!store.logoData) { ctx.beginPath(); ctx.arc(lx + s / 2, ly + s / 2, s / 2, 0, 7); ctx.clip(); }
    ctx.drawImage(logo, lx, ly, lw, s); ctx.restore();
  }
  // Fade to black
  S.fade += (S.fadeTarget - S.fade) * 0.12; if (Math.abs(S.fadeTarget - S.fade) < 0.005) S.fade = S.fadeTarget;
  if (S.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${S.fade})`; ctx.fillRect(0, 0, W, Hh); }
}
// Frames are paced by a worker clock (not slowed down when this window is behind others) and each finished
// frame is handed to the stream exactly once, so viewers get even motion without repeats or skips.
const clock = new Worker("/freecreator/app/clock.js");
let busy = false;
clock.onmessage = () => {
  if (busy) return; busy = true;
  try { draw(); out?.getVideoTracks()[0]?.requestFrame?.(); } catch (e) { console.error(e); } finally { busy = false; }
};
setInterval(tickTimer, 250);
function start() { canvas.width = S.q.w; canvas.height = S.q.h; clock.postMessage(1000 / S.q.fps); }
start();

// ---------------------------------------------------------------- output: stream + recording
let out = null;
function outStream() {
  if (!out) { out = canvas.captureStream(0); const v = out.getVideoTracks()[0]; if (v) v.contentHint = "motion"; }
  return new MediaStream([...out.getVideoTracks(), ...mix.stream.getAudioTracks()]);
}
// The program feed for a full-screen window (HDMI to an ATEM input, a projector or a confidence monitor).
window.__fcProgram = () => { outStream(); return out; };
let rec = null;
async function startRec() {
  await AC.resume();
  const types = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm"], mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [], mr = new MediaRecorder(outStream(), { mimeType, videoBitsPerSecond: S.q.kbps * 1600, audioBitsPerSecond: 192000 });
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(chunks, { type: mimeType })); a.download = `FreeCreator-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`; a.click(); toast("Recording saved to your downloads"); };
  mr.start(2000); rec = { mr, at: Date.now() };
}
let whip = null, lastStats = null;
async function startWhip(url, token) {
  if (!/^https:\/\//.test(url)) throw new Error("Paste the WHIP / WebRTC URL from your streaming service (it starts with https://).");
  await AC.resume();
  const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle", iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
  const ms = outStream();
  for (const t of ms.getTracks()) {
    const tr = pc.addTransceiver(t, { direction: "sendonly", streams: [ms] });
    if (t.kind === "video") {
      const caps = RTCRtpSender.getCapabilities("video")?.codecs || [], h264 = caps.filter((c) => /h264/i.test(c.mimeType) && /42e01f/i.test(c.sdpFmtpLine || ""));
      if (h264.length && tr.setCodecPreferences) tr.setCodecPreferences([...h264, ...caps.filter((c) => !h264.includes(c))]);
      const p = tr.sender.getParameters(); p.encodings = [{ maxBitrate: S.q.kbps * 1000, maxFramerate: S.q.fps }]; p.degradationPreference = "maintain-framerate"; tr.sender.setParameters(p).catch(() => {});
    }
  }
  const offer = await pc.createOffer();
  offer.sdp = offer.sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/, (m, pt, f) => `a=fmtp:${pt} ${f};stereo=1;sprop-stereo=1;maxaveragebitrate=160000`);
  await pc.setLocalDescription(offer);
  await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && r()); setTimeout(r, 2500); });
  const headers = { "content-type": "application/sdp" }; if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: pc.localDescription.sdp }).catch(() => null);
  if (!res || !res.ok) { pc.close(); throw new Error(res ? `The streaming service said no (${res.status}). Check the URL and key.` : "Couldn't reach the streaming service. Check the internet connection."); }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  const loc = res.headers.get("location");
  whip = { pc, resource: loc ? new URL(loc, url).toString() : null, headers, at: whip?.at || Date.now(), url, token };
  pc.addEventListener("connectionstatechange", () => { if (whip?.pc === pc && pc.connectionState === "failed") reconnect(); });
}
// ---- Network watchdog: when the upload struggles, viewers see the holding screen instead of a frozen or broken
// picture, the bitrate steps down, and a dropped connection is re-made automatically.
let wantLive = null, reconnecting = false, badFor = 0, goodFor = 0, cutBitrate = false;
function setAutoHold(on, why) {
  if (!S.autoHold && on) return;
  if (on && !S.hold) { S.hold = true; S.holdAt = Date.now(); toast(why || "Internet is struggling: viewers see the holding screen."); }
  if (!on && S.hold && !S.manualHold) { S.hold = false; toast("Back to the service ✓"); }
  $("stHold").classList.toggle("on", S.hold);
}
async function reconnect() {
  if (reconnecting || !wantLive) return; reconnecting = true;
  setAutoHold(true, "The stream connection dropped. Reconnecting…");
  try { whip?.pc.close(); } catch { /* */ }
  for (let i = 0; wantLive && i < 120; i++) {
    try { await startWhip(wantLive.url, wantLive.token); toast("Stream reconnected ✓"); break; }
    catch { await new Promise((r) => setTimeout(r, Math.min(15000, 2000 + i * 1000))); }
  }
  reconnecting = false;
}
async function watchdog(stats) {
  if (!whip || reconnecting) return;
  const st = whip.pc.connectionState, weak = st === "disconnected" || (stats && (stats.kbps < S.q.kbps * 0.25 || (stats.limit === "bandwidth" && stats.fps < S.q.fps * 0.5)));
  if (weak) { badFor++; goodFor = 0; } else { goodFor++; badFor = 0; }
  const sender = whip.pc.getSenders().find((x) => x.track?.kind === "video");
  if (badFor === 3) { setAutoHold(true); if (sender && !cutBitrate) { const p = sender.getParameters(); if (p.encodings?.[0]) { p.encodings[0].maxBitrate = Math.round(S.q.kbps * 600); sender.setParameters(p).catch(() => {}); cutBitrate = true; } } }
  if (goodFor === 6 && S.hold && !S.manualHold) setAutoHold(false);
  if (goodFor === 20 && cutBitrate && sender) { const p = sender.getParameters(); if (p.encodings?.[0]) { p.encodings[0].maxBitrate = S.q.kbps * 1000; sender.setParameters(p).catch(() => {}); cutBitrate = false; } }
  if (st === "disconnected" && badFor >= 8) reconnect();
}
async function stopWhip() { wantLive = null; const w = whip; whip = null; if (!w) return; if (w.resource) fetch(w.resource, { method: "DELETE", headers: w.headers }).catch(() => {}); w.pc.close(); }
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
setInterval(async () => {
  const parts = [];
  if (whip) {
    const st = await whip.pc.getStats(); let bytes = 0, fps = 0, limit = "none";
    st.forEach((s) => { if (s.type === "outbound-rtp" && s.kind === "video") { bytes = s.bytesSent; fps = s.framesPerSecond || 0; limit = s.qualityLimitationReason || "none"; } });
    const now = Date.now(), kbps = lastStats ? Math.round(((bytes - lastStats.b) * 8) / (now - lastStats.t)) : S.q.kbps; lastStats = { b: bytes, t: now };
    parts.push(`${reconnecting ? "Reconnecting" : "Live"} ${mmss(now - whip.at)} · ${kbps} kbps · ${Math.round(fps)} fps${S.hold ? " · holding screen" : ""}`);
    watchdog({ kbps, fps, limit });
  }
  if (rec) parts.push(`Recording ${mmss(Date.now() - rec.at)}`);
  $("stStats").textContent = parts.join("  ·  ");
  $("stLive").textContent = whip ? "LIVE" : "Preview"; $("stLive").className = `st-pill${whip ? " live" : ""}`;
  $("stRec").hidden = !rec; $("stRec").className = "st-pill rec";
}, 1000);

// ---------------------------------------------------------------- UI wiring
function setScene(sc) { S.scene = sc; if (sc !== "hold") { store.scene = sc; persist(); } S.manualHold = sc === "hold"; if (sc !== "hold" && S.hold && !reconnecting) S.hold = false; $("stHold")?.classList.toggle("on", sc === "hold" || S.hold); document.querySelectorAll("[data-scene]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scene === sc))); }
$("stScenes").innerHTML = SCENES.map(([k, t, d], i) => `<button class="st-scene" data-scene="${k}" aria-pressed="false"><b>${t} <kbd>${i + 1}</kbd></b><small>${d}</small></button>`).join("");
$("stScenes").onclick = (e) => { const b = e.target.closest("[data-scene]"); if (b) setScene(b.dataset.scene); };
setScene(S.scene);
function setL3Shown(on) { S.l3Shown = on && S.l3Active >= 0; S.l3At = Date.now(); $("stL3Toggle").textContent = S.l3Shown ? "Hide lower third" : "Show lower third"; $("stL3Toggle").classList.toggle("on", S.l3Shown); drawL3List(); }
function drawL3List() {
  $("l3List").innerHTML = S.l3.map((it, i) => `<div class="st-l3${i === S.l3Active && S.l3Shown ? " on" : ""}"><input data-l3n="${i}" value="${(it.name || "").replace(/"/g, "&quot;")}" placeholder="Name"><div class="acts"><button class="st-btn" data-l3show="${i}">${i === S.l3Active && S.l3Shown ? "Hide" : "Show"}</button><button class="st-btn" data-l3del="${i}" title="Remove">✕</button></div><input data-l3t="${i}" value="${(it.title || "").replace(/"/g, "&quot;")}" placeholder="Title (optional)"></div>`).join("");
}
const saveL3 = () => { store.l3 = S.l3; persist(); l3Layer.dirty = true; };
$("l3List").oninput = (e) => { const n = e.target.dataset.l3n, t = e.target.dataset.l3t; if (n !== undefined) S.l3[n].name = e.target.value; if (t !== undefined) S.l3[t].title = e.target.value; saveL3(); };
$("l3List").onclick = (e) => {
  const s = e.target.closest("[data-l3show]"), d = e.target.closest("[data-l3del]");
  if (s) { const i = Number(s.dataset.l3show); if (i === S.l3Active && S.l3Shown) setL3Shown(false); else { S.l3Active = i; l3Layer.dirty = true; setL3Shown(true); } }
  if (d) { S.l3.splice(Number(d.dataset.l3del), 1); if (S.l3Active >= S.l3.length) S.l3Active = -1; saveL3(); drawL3List(); }
};
$("l3Add").onclick = () => { S.l3.push({ name: "", title: "" }); saveL3(); drawL3List(); $("l3List").querySelector(`[data-l3n="${S.l3.length - 1}"]`)?.focus(); };
for (const [id, k, parse] of [["l3Style", "l3Style", String], ["l3Color", "l3Color", String], ["l3Auto", "l3Auto", Number]]) { $(id).value = store[k] ?? $(id).value; $(id).onchange = (e) => { S[k] = parse(e.target.value); store[k] = S[k]; persist(); l3Layer.dirty = true; }; }
drawL3List();
$("stL3Toggle").onclick = () => { if (S.l3Active < 0) S.l3Active = 0; l3Layer.dirty = true; setL3Shown(!S.l3Shown); };
const syncToggles = () => { $("stWordsToggle").textContent = `Song words: ${S.wordsOn ? "on" : "off"}`; $("stWordsToggle").classList.toggle("on", S.wordsOn); $("stLogoToggle").textContent = `Logo: ${S.logoOn ? "on" : "off"}`; $("stLogoToggle").classList.toggle("on", S.logoOn); $("stFade").classList.toggle("on", S.fadeTarget > 0); };
$("stWordsToggle").onclick = () => { S.wordsOn = !S.wordsOn; l3Layer.dirty = true; store.wordsOn = S.wordsOn; persist(); syncToggles(); };
$("stLogoToggle").onclick = () => { S.logoOn = !S.logoOn; store.logoOn = S.logoOn; persist(); syncToggles(); };
$("stFade").onclick = () => { S.fadeTarget = S.fadeTarget ? 0 : 1; syncToggles(); };
syncToggles();
document.querySelectorAll(".st-tabs button").forEach((b) => b.onclick = () => { document.querySelectorAll(".st-tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b))); document.querySelectorAll(".st-pane").forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; }); });
addEventListener("keydown", (e) => {
  if (e.target.closest("input,select,textarea")) return;
  const n = Number(e.key); if (n >= 1 && n <= SCENES.length) setScene(SCENES[n - 1][0]);
  const k = e.key.toLowerCase(); if (k === "t") $("stTimerBtn").click(); if (k === "h") $("stHold").click(); if (k === "l") $("stL3Toggle").click(); if (k === "w") $("stWordsToggle").click(); if (k === "g") $("stLogoToggle").click(); if (k === "b") $("stFade").click();
});
$("srcA").onchange = (e) => { store.camA = e.target.value; persist(); useCam("a", e.target.value); };
$("srcB").onchange = (e) => { store.camB = e.target.value; persist(); useCam("b", e.target.value); };
$("srcMic").onchange = (e) => { store.mic = e.target.value; persist(); useMic(e.target.value); };
$("srcScreen").onclick = shareScreen;
$("srcRefresh").onclick = () => listDevices();
$("quality").value = store.quality || "1080p30";
$("quality").onchange = async (e) => { if (whip || rec) { toast("Change quality before going live or recording."); e.target.value = store.quality || "1080p30"; return; } S.q = QUALITY[e.target.value]; store.quality = e.target.value; persist(); out = null; start(); await useCam("a", $("srcA").value); await useCam("b", $("srcB").value); };
$("whipUrl").value = store.whip || ""; $("whipToken").value = sessionStorage.getItem("fc-whip-token") || "";
$("goLive").onclick = async (e) => {
  const b = e.currentTarget;
  if (whip) { if (!confirm("End the live stream now?")) return; await stopWhip(); b.textContent = "Go live"; b.classList.remove("stop"); return; }
  b.disabled = true; b.textContent = "Connecting…";
  try { store.whip = $("whipUrl").value.trim(); persist(); sessionStorage.setItem("fc-whip-token", $("whipToken").value); await startWhip(store.whip, $("whipToken").value.trim()); wantLive = { url: store.whip, token: $("whipToken").value.trim() }; b.textContent = "End stream"; b.classList.add("stop"); toast("You're live 🎉"); }
  catch (err) { toast(err.message); b.textContent = "Go live"; }
  finally { b.disabled = false; }
};
$("recBtn").onclick = async (e) => { if (rec) { rec.mr.stop(); rec = null; e.currentTarget.textContent = "Record"; } else { await startRec(); e.currentTarget.textContent = "Stop recording"; } };

// ---- Holding screen, timer, look
$("stHold").onclick = () => { if (S.scene === "hold" || S.hold) { S.manualHold = false; S.hold = false; setScene(store.scene && store.scene !== "hold" ? store.scene : "cam"); } else setScene("hold"); };
function syncTimer() { $("stTimerBtn").classList.toggle("on", S.timer.on); $("stTimerBtn").innerHTML = `${S.timer.on ? "Stop timer" : "Timer"} <kbd>T</kbd>`; $("timerOut").hidden = !S.timer.on; }
function startTimer() {
  let end;
  const at = $("timerAt").value;
  if (at) { const [h, m] = at.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); end = d.getTime(); }
  else end = Date.now() + Math.max(1, Number($("timerMin").value) || 5) * 60000;
  S.timer = { ...S.timer, on: true, end, total: end - Date.now(), mode: $("timerMode").value, label: $("timerLabel").value.trim() || "Starting in", then: $("timerThen").value };
  Object.assign(store, { timerMode: S.timer.mode, timerLabel: S.timer.label, timerThen: S.timer.then }); persist(); syncTimer();
}
$("timerLabel").value = S.timer.label; $("timerMode").value = S.timer.mode; $("timerThen").value = S.timer.then;
$("timerStart").onclick = startTimer;
$("timerStop").onclick = () => { S.timer.on = false; syncTimer(); };
$("stTimerBtn").onclick = () => { if (S.timer.on) { S.timer.on = false; syncTimer(); } else startTimer(); };
syncTimer();
$("scrStyle").value = S.scrStyle; $("scrStyle").onchange = (e) => { S.scrStyle = e.target.value; store.scrStyle = S.scrStyle; persist(); wordsLayer.dirty = true; };
const drawCorners = () => document.querySelectorAll("#logoCorner [data-c]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === S.logoCorner)));
$("logoCorner").onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; S.logoCorner = b.dataset.c; store.logoCorner = S.logoCorner; persist(); drawCorners(); if (!S.logoOn) $("stLogoToggle").click(); };
drawCorners();
$("logoSize").value = S.logoSize; $("logoSize").oninput = (e) => { S.logoSize = Number(e.target.value); store.logoSize = S.logoSize; persist(); };
$("logoOpacity").value = S.logoOpacity; $("logoOpacity").oninput = (e) => { S.logoOpacity = Number(e.target.value); store.logoOpacity = S.logoOpacity; persist(); };
$("logoUpload").onclick = () => {
  const i = document.createElement("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    const img = new Image(); img.src = URL.createObjectURL(f); await img.decode().catch(() => null);
    const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    store.logoData = c.toDataURL("image/png"); persist(); loadLogo(); if (!S.logoOn) $("stLogoToggle").click(); toast("Logo updated");
  };
  i.click();
};
$("logoReset").onclick = () => { delete store.logoData; persist(); loadLogo(); };
$("holdMsg").value = S.holdMsg; $("holdSub").value = S.holdSub; $("autoHold").checked = S.autoHold;
$("holdMsg").oninput = (e) => { S.holdMsg = e.target.value || "We'll be right back"; store.holdMsg = e.target.value; persist(); };
$("holdSub").oninput = (e) => { S.holdSub = e.target.value; store.holdSub = e.target.value; persist(); };
$("autoHold").onchange = (e) => { S.autoHold = e.target.checked; store.autoHold = S.autoHold; persist(); };
// ---- Sources: tap A or B
$("srcList").onclick = (e) => { const b = e.target.closest("[data-to]"); if (!b) return; const sel = $(b.dataset.to === "a" ? "srcA" : "srcB"); sel.value = b.dataset.v; sel.dispatchEvent(new Event("change")); drawSources(); };
// ---- Program out: find screens (incl. an ATEM fed by HDMI) and open the program full screen there
let screenDetails = null;
async function findScreens(ask) {
  if (!("getScreenDetails" in window)) { if (ask) toast("Finding screens needs Chrome or Edge. You can still drag the program window to any screen."); return; }
  if (!ask) { const p = await navigator.permissions.query({ name: "window-management" }).catch(() => null); if (p?.state !== "granted") return; }
  try {
    screenDetails = await window.getScreenDetails();
    const fill = () => {
      const cur = screenDetails.currentScreen, list = screenDetails.screens;
      $("progScreen").innerHTML = `<option value="">This screen (window)</option>` + list.map((sc, i) => `<option value="${i}">${(sc.label || `Screen ${i + 1}`).replace(/</g, "")} · ${sc.width}×${sc.height}${sc.isPrimary ? " · main" : ""}${sc === cur ? " · this one" : ""}${/atem|blackmagic/i.test(sc.label) ? " · ATEM" : ""}</option>`).join("");
      const atem = list.findIndex((sc) => /atem|blackmagic/i.test(sc.label)), other = list.findIndex((sc) => sc !== cur);
      $("progScreen").value = String(atem >= 0 ? atem : other >= 0 ? other : "");
      if (ask) toast(`${list.length} ${list.length === 1 ? "screen" : "screens"} found${atem >= 0 ? " · ATEM input ready" : ""}`);
    };
    fill(); screenDetails.onscreenschange = () => { fill(); toast("Screens changed"); };
  } catch { if (ask) toast("Allow “Window management” for this site to place the program on another screen."); }
}
$("progDetect").onclick = () => findScreens(true);
findScreens(false);
let progWin = null;
$("progOpen").onclick = () => {
  const sc = screenDetails?.screens[Number($("progScreen").value)];
  const feat = $("progScreen").value !== "" && sc ? `popup,left=${sc.availLeft},top=${sc.availTop},width=${sc.availWidth},height=${sc.availHeight}` : "popup,width=960,height=540";
  progWin = window.open("/freecreator/app/program.html", "freecreator-program", feat);
  if (!progWin) return toast("Your browser blocked the window. Allow pop-ups for this site.");
  toast(sc ? "Program window opened. Click it once for full screen." : "Program window opened. Drag it to the screen you want, then click it for full screen.");
};

// Internet check: upload a sample and suggest the right quality.
$("stTest").onclick = async (e) => {
  const b = e.currentTarget; b.disabled = true; b.textContent = "Testing…";
  try {
    const blob = new Blob([crypto.getRandomValues(new Uint8Array(65536))]), parts = Array.from({ length: 32 }, () => blob), body = new Blob(parts);   // 2 MB
    const t0 = performance.now(); const r = await fetch("/api/freecreator/speedtest", { method: "POST", headers: { "x-scc-admin": "1" }, credentials: "same-origin", body }); await r.json();
    const mbps = (body.size * 8) / ((performance.now() - t0) / 1000) / 1e6, el = $("stNet");
    const pick = mbps >= 15 ? "1080p60" : mbps >= 9 ? "1080p30" : "720p30";
    el.textContent = `Upload ≈ ${mbps.toFixed(1)} Mbps · best: ${pick.replace("p", "p ")}`; el.className = `st-net ${mbps >= 9 ? "good" : mbps >= 5 ? "weak" : "bad"}`;
    if (mbps < 5) toast("Your upload is weak for streaming. Use 720p, move closer to the router or use a cable.");
  } catch { toast("Couldn't test the connection."); }
  finally { b.disabled = false; b.textContent = "Test internet"; }
};

// ---------------------------------------------------------------- AI helpers
async function ai(task, text) {
  const r = await fetch("/api/freecreator/ai", { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify({ task, text }) }).then((x) => x.json()).catch(() => null);
  return r?.ok ? r.text : null;
}
const jsonFrom = (t) => { if (!t) return null; const m = t.match(/[[{][\s\S]*[\]}]/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const aiOut = (html) => { $("aiOut").innerHTML = html; };
$("aiL3").onclick = async () => {
  const topic = $("aiTopic").value.trim(); if (!topic) return toast("Tell the AI what the service is about first.");
  aiOut(`<p class="st-hint">Writing…</p>`);
  const list = jsonFrom(await ai("lowerthirds", topic));
  if (!Array.isArray(list) || !list.length) return aiOut(`<p class="st-hint">The AI is resting right now. Try again in a minute.</p>`);
  const items = list.slice(0, 6).map((x) => ({ name: String(x.name || "").slice(0, 60), title: String(x.title || "").slice(0, 90) })).filter((x) => x.name);
  aiOut(items.map((x, i) => `<div class="st-ai-card"><b>${x.name.replace(/</g, "")}</b>\n${x.title.replace(/</g, "")}<br><button class="st-btn" data-use="${i}">Add to lower thirds</button></div>`).join(""));
  $("aiOut").onclick = (e) => { const b = e.target.closest("[data-use]"); if (!b) return; S.l3.push(items[Number(b.dataset.use)]); saveL3(); drawL3List(); b.textContent = "Added ✓"; b.disabled = true; };
};
$("aiTitle").onclick = async () => {
  const topic = $("aiTopic").value.trim(); if (!topic) return toast("Tell the AI what the service is about first.");
  aiOut(`<p class="st-hint">Writing…</p>`);
  const o = jsonFrom(await ai("streamtext", topic));
  if (!o?.title) return aiOut(`<p class="st-hint">The AI is resting right now. Try again in a minute.</p>`);
  const text = `${o.title}\n\n${o.description || ""}`;
  aiOut(`<div class="st-ai-card">${text.replace(/</g, "")}<br><button class="st-btn" id="aiCopy">Copy</button></div>`);
  $("aiCopy").onclick = () => navigator.clipboard.writeText(text).then(() => toast("Copied"));
};
$("aiBg").onclick = async (e) => {
  const b = e.currentTarget, topic = $("aiTopic").value.trim() || "worship";
  b.disabled = true; aiOut(`<p class="st-hint">Painting a background (about 10 seconds)…</p>`);
  try {
    const r = await fetch(`/api/freecreator/paint?topic=${encodeURIComponent(topic)}&v=${Math.floor(Math.random() * 3)}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error();
    const img = new Image(); img.src = URL.createObjectURL(await r.blob()); await img.decode();
    S.bgImg = img; setScene("slides");
    aiOut(`<div class="st-ai-card">New background on the Slides scenes. Paint again for another.</div>`);
  } catch { aiOut(`<p class="st-hint">The painter is busy. Try again in a moment.</p>`); }
  finally { b.disabled = false; }
};

// ---------------------------------------------------------------- start
await listDevices();
if ($("srcA").value) useCam("a", $("srcA").value);
if ($("srcB").value) useCam("b", $("srcB").value);
if ($("srcMic").value) useMic($("srcMic").value);
document.addEventListener("click", () => AC.resume(), { once: true });
addEventListener("beforeunload", (e) => { if (whip || rec) { e.preventDefault(); e.returnValue = ""; } });
