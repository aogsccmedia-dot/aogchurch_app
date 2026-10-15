// FreeCreator Studio (online): cameras / HDMI / ATEM-over-USB inputs, scenes, animated lower thirds, the song words
// from FreeCreator, background music, recording and live streaming (WHIP), all in the browser.
// Built for speed: one canvas compositor on a steady timer, overlay layers cached and only redrawn when they change.
const me = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
if (!me?.user) { location.replace("/freecreator?signin=1"); await new Promise(() => {}); }
const $ = (id) => document.getElementById(id);
const KEY = `freecreator:${me.user.id}:studio`;
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
  l3: store.l3 || [{ name: "Pastor Thabo", title: "Senior Pastor" }, { name: "Welcome home", title: "AOG Sandton City Church · 17 Humber Street, Woodmead" }],
  l3Style: store.l3Style || "bar", l3Color: store.l3Color || "#d6a650", l3Auto: Number(store.l3Auto ?? 10), l3Active: -1, l3Shown: false, l3Anim: 0, l3At: 0,
  bgImg: null,
};
const SCENES = [
  ["cam", "Camera", "Camera A, full"], ["camwords", "Camera + words", "Song words as a lower band"], ["slides", "Slides", "Words on a background"],
  ["pip", "Two cameras", "Camera B in the corner"], ["slidescam", "Slides + camera", "Speaker in the corner"], ["screen", "Screen share", "With camera in the corner"],
];

// ---------------------------------------------------------------- inputs
const vid = (name) => { const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.dataset.name = name; return v; };
const V = { a: vid("a"), b: vid("b"), screen: vid("screen") };
const streams = { a: null, b: null, screen: null, mic: null };
async function listDevices() {
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true })); s?.getTracks().forEach((t) => t.stop()); } catch { /* no permission */ }
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const cams = all.filter((d) => d.kind === "videoinput"), mics = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications");
  const label = (d, i, k) => `${d.label || `${k} ${i + 1}`}${/blackmagic|atem/i.test(d.label) ? " · ATEM" : /capture|hdmi|elgato|cam link|magewell|avermedia/i.test(d.label) ? " · HDMI" : ""}`;
  const fill = (sel, list, k, saved) => { sel.innerHTML = `<option value="">None</option>` + list.map((d, i) => `<option value="${d.deviceId}">${label(d, i, k).replace(/</g, "")}</option>`).join(""); if (saved && list.some((d) => d.deviceId === saved)) sel.value = saved; };
  fill($("srcA"), cams, "Camera", store.camA ?? cams[0]?.deviceId); fill($("srcB"), cams, "Camera", store.camB); fill($("srcMic"), mics, "Microphone", store.mic ?? mics[0]?.deviceId);
}
async function useCam(slot, deviceId) {
  streams[slot]?.getTracks().forEach((t) => t.stop()); streams[slot] = null; V[slot].srcObject = null;
  if (!deviceId) return;
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
const canvas = $("stCanvas"), ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
const layer = () => { const c = document.createElement("canvas"); return { c, x: c.getContext("2d"), dirty: true }; };
const wordsLayer = layer(), l3Layer = layer();
let logo = null; { const i = new Image(); i.onload = () => { logo = i; }; i.src = "/assets/logo-192.png"; }
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
/** The words layer: drawn only when the words, scene or size change. */
function renderWords(full) {
  const W = canvas.width, Hh = canvas.height, L = wordsLayer; L.c.width = W; L.c.height = Hh; L.x.clearRect(0, 0, W, Hh);
  const text = S.words.trim(); if (!text) return;
  const lines = text.split("\n").filter(Boolean).slice(0, full ? 8 : 4), x = L.x;
  const bandH = full ? Hh * 0.8 : Hh * 0.26, maxW = W * (full ? 0.86 : 0.8);
  let size = Math.round(Hh * (full ? 0.085 : 0.05));
  const font = (s) => `700 ${s}px ${SANS}`;
  x.font = font(size);
  while (size > 18 && (lines.some((l) => x.measureText(l).width > maxW) || lines.length * size * 1.22 > bandH)) { size -= 2; x.font = font(size); }
  x.textAlign = "center"; x.textBaseline = "middle";
  if (full) {
    x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = size * 0.35; x.fillStyle = "#fff";
    const top = Hh / 2 - ((lines.length - 1) * size * 1.22) / 2 - (S.reference ? size * 0.5 : 0);
    lines.forEach((l, i) => x.fillText(l, W / 2, top + i * size * 1.22));
    if (S.reference) { x.font = `600 ${size * 0.55}px ${SANS}`; x.fillStyle = "#ffd27a"; x.fillText(S.reference, W / 2, top + lines.length * size * 1.22 + size * 0.2); }
  } else {
    const boxW = Math.min(W * 0.9, Math.max(...lines.map((l) => x.measureText(l).width)) + W * 0.06), boxH = lines.length * size * 1.22 + size * 0.9;
    const bx = (W - boxW) / 2, by = Hh - boxH - Hh * 0.05;
    x.fillStyle = "rgba(0,0,0,.6)"; x.beginPath(); x.roundRect(bx, by, boxW, boxH, Hh * 0.015); x.fill();
    x.fillStyle = "#fff"; lines.forEach((l, i) => x.fillText(l, W / 2, by + size * 0.95 + i * size * 1.22));
  }
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
  else { x.fillStyle = acc; x.fillRect(m, baseY + 6, Math.max(nw, tw) + W * 0.02, 4); }
  const ox = m + (style === "pill" ? h * 0.85 : W * 0.025), nameInk = style === "block" ? (luma(acc) > 0.55 ? "#111" : "#fff") : "#fff";
  x.shadowColor = style === "line" ? "rgba(0,0,0,.7)" : "transparent"; x.shadowBlur = style === "line" ? 14 : 0;
  x.fillStyle = nameInk; x.font = `700 ${nameS}px ${SANS}`; x.textBaseline = "alphabetic"; x.fillText(it.name || "", ox, baseY - h + Hh * 0.012 + nameS);
  if (it.title) { x.fillStyle = style === "block" ? "#fff" : "rgba(255,255,255,.82)"; x.font = `500 ${titleS}px ${SANS}`; x.fillText(it.title, ox, baseY - h + Hh * 0.018 + nameS * 1.25 + titleS); }
  x.restore();
}
function luma(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
let lastSize = "";
function draw() {
  const W = canvas.width, Hh = canvas.height, sc = S.scene, size = `${W}x${Hh}:${sc}`;
  if (size !== lastSize) { lastSize = size; wordsLayer.dirty = true; l3Layer.dirty = true; }
  // Base picture
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
  // Logo bug
  if (S.logoOn && logo) { const s = Hh * 0.09, m = W * 0.025; ctx.save(); ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(W - m - s / 2, m + s / 2, s / 2, 0, 7); ctx.clip(); ctx.drawImage(logo, W - m - s, m, s, s); ctx.restore(); }
  // Fade to black
  S.fade += (S.fadeTarget - S.fade) * 0.12; if (Math.abs(S.fadeTarget - S.fade) < 0.005) S.fade = S.fadeTarget;
  if (S.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${S.fade})`; ctx.fillRect(0, 0, W, Hh); }
}
let timer = 0;
function start() { clearInterval(timer); canvas.width = S.q.w; canvas.height = S.q.h; timer = setInterval(draw, 1000 / S.q.fps); }   // a timer keeps drawing when this window is behind others
start();

// ---------------------------------------------------------------- output: stream + recording
let out = null;
function outStream() { if (!out) out = canvas.captureStream(S.q.fps); return new MediaStream([...out.getVideoTracks(), ...mix.stream.getAudioTracks()]); }
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
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && r()); setTimeout(r, 2500); });
  const headers = { "content-type": "application/sdp" }; if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: pc.localDescription.sdp }).catch(() => null);
  if (!res || !res.ok) { pc.close(); throw new Error(res ? `The streaming service said no (${res.status}). Check the URL and key.` : "Couldn't reach the streaming service. Check the internet connection."); }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  const loc = res.headers.get("location");
  whip = { pc, resource: loc ? new URL(loc, url).toString() : null, headers, at: Date.now() };
  pc.addEventListener("connectionstatechange", () => { if (["failed", "disconnected"].includes(pc.connectionState)) toast("The stream connection dropped. Check the internet; FreeCreator keeps trying."); });
}
async function stopWhip() { const w = whip; whip = null; if (!w) return; if (w.resource) fetch(w.resource, { method: "DELETE", headers: w.headers }).catch(() => {}); w.pc.close(); }
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
setInterval(async () => {
  const parts = [];
  if (whip) {
    const st = await whip.pc.getStats(); let bytes = 0, fps = 0;
    st.forEach((s) => { if (s.type === "outbound-rtp" && s.kind === "video") { bytes = s.bytesSent; fps = s.framesPerSecond || 0; } });
    const now = Date.now(), kbps = lastStats ? Math.round(((bytes - lastStats.b) * 8) / (now - lastStats.t)) : 0; lastStats = { b: bytes, t: now };
    parts.push(`Live ${mmss(now - whip.at)} · ${kbps} kbps · ${Math.round(fps)} fps`);
  }
  if (rec) parts.push(`Recording ${mmss(Date.now() - rec.at)}`);
  $("stStats").textContent = parts.join("  ·  ");
  $("stLive").textContent = whip ? "LIVE" : "Preview"; $("stLive").className = `st-pill${whip ? " live" : ""}`;
  $("stRec").hidden = !rec; $("stRec").className = "st-pill rec";
}, 1000);

// ---------------------------------------------------------------- UI wiring
function setScene(sc) { S.scene = sc; store.scene = sc; persist(); document.querySelectorAll("[data-scene]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scene === sc))); }
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
  const k = e.key.toLowerCase(); if (k === "l") $("stL3Toggle").click(); if (k === "w") $("stWordsToggle").click(); if (k === "g") $("stLogoToggle").click(); if (k === "b") $("stFade").click();
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
  try { store.whip = $("whipUrl").value.trim(); persist(); sessionStorage.setItem("fc-whip-token", $("whipToken").value); await startWhip(store.whip, $("whipToken").value.trim()); b.textContent = "End stream"; b.classList.add("stop"); toast("You're live 🎉"); }
  catch (err) { toast(err.message); b.textContent = "Go live"; }
  finally { b.disabled = false; }
};
$("recBtn").onclick = async (e) => { if (rec) { rec.mr.stop(); rec = null; e.currentTarget.textContent = "Record"; } else { await startRec(); e.currentTarget.textContent = "Stop recording"; } };

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
