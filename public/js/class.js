// The online discipleship class room: video and sound go straight between the people in the class (WebRTC, one
// connection to each person), so nothing passes through the church's server except the short "how to connect"
// messages. Pastors can switch on automatic notes: then each person's own microphone is sent in short pieces to be
// turned into text, and everyone sees "Notes are on". When the pastor ends the class, everyone who joined gets the
// summary and full notes as a PDF by email.
import { api, esc, toast } from "./site.js";
import { icon } from "./icons.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";
const STAR = `<span class="pastor-star" title="Verified pastor" role="img" aria-label="Verified pastor">${icon("star")}</span>`;

let me = null, ice = [], local = null, screen = null, polling = 0, notesOn = false, ended = false, leaving = false;
let micOn = true, camOn = true;
const peers = new Map();   // id → { pc, name, pastor, tile, since }

// ---------------------------------------------------------------- small helpers
function ask(title, text, yes = "Yes") {
  const d = $("room-ask");
  $("ask-title").textContent = title; $("ask-text").textContent = text; $("ask-yes").textContent = yes;
  d.showModal();
  return new Promise((res) => {
    const done = (v) => { d.close(); $("ask-yes").onclick = $("ask-no").onclick = null; res(v); };
    $("ask-yes").onclick = () => done(true); $("ask-no").onclick = () => done(false);
    d.oncancel = () => done(false);
  });
}
const status = (t) => { $("room-status").textContent = t || ""; };
const post = (path, body = {}) => api(path, { method: "POST", body });

function setBtn(b, on, onIcon, offIcon, onLabel, offLabel) {
  b.setAttribute("aria-pressed", String(on));
  b.classList.toggle("off", !on);
  b.innerHTML = `${icon(on ? onIcon : offIcon)}<span>${on ? onLabel : offLabel}</span>`;
}

// ---------------------------------------------------------------- tiles
function tile(pid, name, pastor, self = false) {
  let t = $("room-grid").querySelector(`[data-peer="${CSS.escape(pid)}"]`);
  if (!t) {
    t = document.createElement("figure");
    t.className = "room-tile" + (self ? " self" : "");
    t.dataset.peer = pid;
    t.innerHTML = `<video autoplay playsinline ${self ? "muted" : ""}></video><span class="room-face" aria-hidden="true"></span>
      <figcaption><span class="room-name"></span><span class="room-muted" hidden>${icon("micOff")}</span></figcaption>`;
    $("room-grid").append(t);
  }
  t.querySelector(".room-name").innerHTML = `${esc(self ? `${name} (you)` : name)}${pastor ? STAR : ""}`;
  t.querySelector(".room-face").textContent = (name || "?").trim().charAt(0).toUpperCase();
  layout();
  return t;
}
function layout() {
  const n = $("room-grid").children.length;
  $("room-grid").dataset.n = String(Math.min(n, 9));
}
function showVideo(t, stream) {
  const v = t.querySelector("video");
  if (v.srcObject !== stream) v.srcObject = stream;
  const hasVideo = () => stream.getVideoTracks().some((x) => x.readyState === "live" && x.enabled && !x.muted);
  const upd = () => t.classList.toggle("no-video", !hasVideo());
  stream.getVideoTracks().forEach((x) => { x.onmute = upd; x.onunmute = upd; x.onended = upd; });
  stream.onaddtrack = () => showVideo(t, stream);
  upd();
  v.play?.().catch(() => {});
}

// ---------------------------------------------------------------- media
async function getMedia() {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try { return await navigator.mediaDevices.getUserMedia({ audio, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } }); }
  catch {
    try { camOn = false; return await navigator.mediaDevices.getUserMedia({ audio }); }
    catch { micOn = false; return new MediaStream(); }
  }
}
const videoTrack = () => (screen?.getVideoTracks()[0]) || local.getVideoTracks()[0] || null;

// ---------------------------------------------------------------- connections
function makePc(pid, name, pastor, offerer) {
  const old = peers.get(pid); if (old) old.pc.close();
  const pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" });
  // The caller sets up one sound and one picture line (even without a mic or camera, so they still hear and see others).
  if (offerer) for (const kind of ["audio", "video"]) pc.addTransceiver(kind, { direction: "sendrecv" });
  const t = tile(pid, name, pastor);
  const stream = new MediaStream();
  pc.ontrack = (e) => { stream.getTracks().filter((x) => x.kind === e.track.kind).forEach((x) => stream.removeTrack(x)); stream.addTrack(e.track); showVideo(t, stream); };
  pc.onconnectionstatechange = () => {
    t.classList.toggle("connecting", pc.connectionState !== "connected");
    if (pc.connectionState === "failed" && me.id < pid && !ended) setTimeout(() => peers.get(pid)?.pc === pc && call(pid, name, pastor), 1500);
  };
  t.classList.add("connecting");
  const p = { pc, name, pastor, tile: t, since: Date.now() };
  peers.set(pid, p);
  return p;
}
/** Put my microphone and camera (or shared screen) on the connection's sound and picture lines. */
async function attach(pc) {
  for (const tr of pc.getTransceivers()) {
    const kind = tr.receiver.track?.kind; if (!kind || tr.stopped) continue;
    tr.direction = "sendrecv";
    await tr.sender.replaceTrack(kind === "audio" ? local.getAudioTracks()[0] || null : videoTrack()).catch(() => {});
  }
}
function gathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => { const t = setTimeout(res, 2500); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } }); });
}
async function call(pid, name, pastor) {
  const { pc } = makePc(pid, name, pastor, true);
  await attach(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  await post(`/api/classes/${id}/signal`, { to: pid, kind: "offer", sdp: pc.localDescription.sdp }).catch(() => {});
}
async function onSignal(s, people) {
  const who = people.find((p) => p.id === s.from) || { name: "Someone", pastor: false };
  if (s.kind === "offer") {
    const mine = peers.get(s.from);
    // Both called each other at once: the one with the smaller id answers, the other ignores the call.
    if (mine && mine.pc.signalingState === "have-local-offer" && me.id > s.from) return;
    const { pc } = makePc(s.from, who.name, who.pastor, false);
    await pc.setRemoteDescription({ type: "offer", sdp: s.body });
    await attach(pc);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await post(`/api/classes/${id}/signal`, { to: s.from, kind: "answer", sdp: pc.localDescription.sdp }).catch(() => {});
  } else if (s.kind === "answer") {
    const p = peers.get(s.from);
    if (p && p.pc.signalingState === "have-local-offer") await p.pc.setRemoteDescription({ type: "answer", sdp: s.body }).catch(() => {});
  }
}
function drop(pid) {
  const p = peers.get(pid); if (!p) return;
  p.pc.close(); p.tile.remove(); peers.delete(pid); layout();
}

async function poll() {
  if (ended || leaving) return;
  try {
    const d = await api(`/api/classes/${id}/poll`);
    if (d.status === "ended") return finish("The pastor has ended the class. Thank you for joining!");
    setNotes(d.notes_on);
    for (const s of d.signals) await onSignal(s, d.people).catch(() => {});
    const here = new Set(d.people.map((p) => p.id));
    for (const pid of [...peers.keys()]) if (!here.has(pid)) drop(pid);
    for (const p of d.people) {
      const known = peers.get(p.id);
      if (known) { if (known.name !== p.name || known.pastor !== p.pastor) { known.name = p.name; known.pastor = p.pastor; tile(p.id, p.name, p.pastor); } continue; }
      // Someone here we have no connection with (their call was lost): the smaller id calls.
      if (me.id < p.id) call(p.id, p.name, p.pastor);
    }
    status(d.people.length ? "" : "Waiting for others to join…");
  } catch (e) {
    if (e.status === 409) return finish("You've left the class.");
    status("Reconnecting…");
  }
  polling = setTimeout(poll, document.hidden ? 3000 : 1500);
}

// ---------------------------------------------------------------- notes: my own microphone, in short pieces
let rec = null;
function setNotes(on) {
  notesOn = !!on;
  $("room-notes").hidden = !notesOn;
  if (me?.teacher) setBtn($("b-notes"), notesOn, "notebook", "notebook", "Notes on", "Notes off");
  if (notesOn && !rec) startRec(); else if (!notesOn && rec) stopRec();
}
function startRec() {
  const tr = local.getAudioTracks()[0]; if (!tr) return;
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(new MediaStream([tr]));
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain(); sink.gain.value = 0;
  let buf = [], len = 0, startedAt = Date.now();
  const SECONDS = 20;
  node.onaudioprocess = (e) => {
    if (!micOn) { buf = []; len = 0; startedAt = Date.now(); return; }
    const d = e.inputBuffer.getChannelData(0); buf.push(new Float32Array(d)); len += d.length;
    if (len >= ctx.sampleRate * SECONDS) { const pcs = buf; const at = startedAt; buf = []; len = 0; startedAt = Date.now(); send(pcs, ctx.sampleRate, at); }
  };
  src.connect(node); node.connect(sink); sink.connect(ctx.destination);
  rec = { ctx, flush: () => { if (len > ctx.sampleRate * 2) send(buf, ctx.sampleRate, startedAt); buf = []; len = 0; } };
}
function stopRec() { if (!rec) return; rec.flush(); rec.ctx.close().catch(() => {}); rec = null; }
function send(pieces, rate, at) {
  const total = pieces.reduce((n, p) => n + p.length, 0), all = new Float32Array(total);
  let o = 0; for (const p of pieces) { all.set(p, o); o += p.length; }
  // Quiet pieces (nobody speaking) aren't sent.
  let sum = 0; for (let i = 0; i < all.length; i += 4) sum += all[i] * all[i];
  if (Math.sqrt(sum / (all.length / 4)) < 0.008) return;
  const ratio = rate / 16000, n = Math.floor(all.length / ratio), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (off, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); wav.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt "); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, 16000, true); wav.setUint32(28, 32000, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); str(36, "data"); wav.setUint32(40, pcm.length * 2, true);
  new Int16Array(wav.buffer, 44).set(pcm);
  fetch(`/api/classes/${id}/notes/chunk`, { method: "POST", credentials: "same-origin", headers: { "x-scc-admin": "1", "Content-Type": "audio/wav", "x-said-at": String(at) }, body: wav.buffer }).catch(() => {});
}

// ---------------------------------------------------------------- controls
function applyTracks() {
  local.getAudioTracks().forEach((t) => { t.enabled = micOn; });
  local.getVideoTracks().forEach((t) => { t.enabled = camOn; });
  const self = $("room-grid").querySelector(".room-tile.self");
  if (self) { self.querySelector(".room-muted").hidden = micOn; self.classList.toggle("no-video", !camOn && !screen); }
  setBtn($("b-mic"), micOn, "mic", "micOff", "Mic", "Muted");
  setBtn($("b-cam"), camOn, "video", "videoOff", "Camera", "Camera off");
}
async function replaceVideo(track) {
  for (const { pc } of peers.values()) {
    const tr = pc.getTransceivers().find((x) => x.receiver.track?.kind === "video" && !x.stopped);
    if (tr) await tr.sender.replaceTrack(track).catch(() => {});
  }
  const self = $("room-grid").querySelector(".room-tile.self");
  if (self) showVideo(self, new MediaStream([...(track ? [track] : [])]));
}
async function toggleShare() {
  if (screen) { screen.getTracks().forEach((t) => t.stop()); screen = null; await replaceVideo(local.getVideoTracks()[0] || null); }
  else {
    if (!navigator.mediaDevices.getDisplayMedia) { toast("Sharing your screen works on a computer."); return; }
    try { screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
    catch { return; }
    const t = screen.getVideoTracks()[0];
    t.onended = () => { if (screen) toggleShare(); };
    await replaceVideo(t);
  }
  $("room-grid").querySelector(".room-tile.self")?.classList.toggle("sharing", !!screen);
  setBtn($("b-share"), !!screen, "monitor", "monitor", "Stop sharing", "Share screen");
  applyTracks();
}

function finish(text) {
  if (ended) return;
  ended = true; clearTimeout(polling); stopRec();
  for (const pid of [...peers.keys()]) drop(pid);
  local?.getTracks().forEach((t) => t.stop()); screen?.getTracks().forEach((t) => t.stop());
  $("room").hidden = true; $("room-lobby").hidden = false; $("room-preview").hidden = true; $("room-note").hidden = true;
  $("room-when").textContent = text;
  $("room-actions").innerHTML = `<a class="btn btn-gold" href="/discipleship">Back to discipleship</a><a class="btn" href="/me">Home</a>`;
}
function leaveNow() {
  if (leaving || ended) return; leaving = true;
  fetch(`/api/classes/${id}/leave`, { method: "POST", keepalive: true, credentials: "same-origin", headers: { "x-scc-admin": "1", "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

// ---------------------------------------------------------------- start
async function join() {
  const go = $("room-actions").querySelector("button"); if (go) go.disabled = true;
  try {
    const d = await post(`/api/classes/${id}/join`);
    me = d.me; ice = d.ice;
  } catch (e) { toast(e.message); if (go) go.disabled = false; return; }
  $("room-lobby").hidden = true; $("room").hidden = false;
  $("room-live-title").textContent = $("room-title").textContent;
  $("b-notes").hidden = $("b-end").hidden = !me.teacher;
  const self = tile(me.id, me.name, me.pastor, true);
  showVideo(self, local);
  applyTracks();
  const first = await api(`/api/classes/${id}/poll`).catch(() => ({ people: [] }));
  for (const p of first.people || []) call(p.id, p.name, p.pastor);
  setNotes(first.notes_on);
  polling = setTimeout(poll, 1500);
}

async function start() {
  if (!id) { finish("That class link isn't complete."); return; }
  let info;
  try { info = await api(`/api/classes/${id}`); }
  catch (e) { $("room-title").textContent = "Discipleship class"; $("room-when").textContent = e.message; $("room-actions").innerHTML = `<a class="btn btn-gold" href="/discipleship">See discipleship classes</a>`; return; }
  const c = info.class;
  $("room-title").textContent = c.title;
  $("room-when").textContent = `${c.when} · ${c.minutes} minutes${c.mode === "in_person" ? ` · at ${c.location || "church"}` : " · online"}`;
  const A = $("room-actions");
  if (c.status === "ended") {
    A.innerHTML = info.notes_pdf ? `<a class="btn btn-gold" href="/api/classes/${esc(id)}/notes.pdf">${icon("download")} Download the notes (PDF)</a>` : `<p class="muted-text">This class has finished.</p>`;
    return;
  }
  if (c.mode !== "online") { A.innerHTML = `<p class="muted-text">This class meets in person. See you there!</p>`; return; }
  if (!info.signed_in) { A.innerHTML = `<a class="btn btn-gold" href="/signin?next=${encodeURIComponent(location.pathname + location.search)}">Sign in to join</a>`; return; }
  if (!info.may_join) { A.innerHTML = `<p class="muted-text">Online classes are for members who signed up.</p><a class="btn btn-gold" href="/discipleship#signup">Sign up for classes</a>`; return; }
  if (c.status !== "live" && !info.is_teacher) {
    A.innerHTML = `<p class="muted-text">The room opens when the pastor starts the class. This page checks by itself.</p>`;
    setTimeout(start, 15000); return;
  }
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) { A.innerHTML = `<p class="muted-text">This browser can't join video calls. Please use an up-to-date Chrome, Edge, Safari or Firefox.</p>`; return; }
  $("room-note").hidden = false;
  local = await getMedia();
  $("room-preview").hidden = false;
  $("room-self-preview").srcObject = local;
  const pre = () => {
    setBtn($("pre-mic"), micOn, "mic", "micOff", "Mic on", "Muted");
    setBtn($("pre-cam"), camOn, "video", "videoOff", "Camera on", "Camera off");
    local.getAudioTracks().forEach((t) => { t.enabled = micOn; }); local.getVideoTracks().forEach((t) => { t.enabled = camOn; });
    $("room-preview").classList.toggle("no-video", !camOn || !local.getVideoTracks().length);
  };
  $("pre-mic").onclick = () => { micOn = !micOn; pre(); };
  $("pre-cam").onclick = () => { camOn = !camOn; pre(); };
  pre();
  if (!local.getAudioTracks().length) toast("We couldn't reach your microphone. Check the browser's permission (the camera icon in the address bar).", 6000);
  A.innerHTML = `<button type="button" class="btn btn-gold btn-lg" id="room-join">${icon("video")} ${info.is_teacher && c.status !== "live" ? "Start the class" : "Join the class"}</button>`;
  $("room-join").onclick = join;
}

$("b-mic").onclick = () => { micOn = !micOn; applyTracks(); };
$("b-cam").onclick = () => { camOn = !camOn; applyTracks(); };
$("b-share").onclick = toggleShare;
$("b-notes").onclick = async () => {
  const on = !notesOn;
  if (on && !(await ask("Switch on notes?", "Everyone will see “Notes are on”. What's said is turned into text, and when you end the class everyone who joined gets a summary and the full notes as a PDF.", "Switch on"))) return;
  try { const r = await post(`/api/classes/${id}/notes`, { on }); setNotes(r.notes_on); toast(on ? "Notes are on." : "Notes are off."); } catch (e) { toast(e.message); }
};
$("b-leave").onclick = async () => {
  if (me?.teacher && !(await ask("Leave the class?", "The class stays open for the others. To close it for everyone, use End class.", "Leave"))) return;
  leaveNow(); finish("You've left the class. You can rejoin from the discipleship page while it's live.");
};
$("b-end").onclick = async () => {
  if (!(await ask("End the class for everyone?", "Everyone leaves the room. If notes were on, the summary and PDF go to everyone who joined in a minute or two.", "End class"))) return;
  stopRec();
  try { const r = await post(`/api/classes/${id}/end`); finish(r.notes ? "Class ended. The notes are being emailed to everyone who joined." : "Class ended. Thank you!"); }
  catch (e) { toast(e.message); }
};
addEventListener("pagehide", leaveNow);
start();
