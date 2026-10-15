// FreeCreator phone camera: sends this phone's camera (and optionally its sound) straight to the Studio over WebRTC.
// Only for the accounts the main admin allows (phones are extra cameras during services and livestreams).
const $ = (id) => document.getElementById(id);
const me = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
if (!me?.user) { location.replace("/freecreator?signin=1"); await new Promise(() => {}); }
const access = await fetch("/api/freecreator/access", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({}));
if (!access.mobile) {
  document.body.innerHTML = `<div class="pc-blocked"><h2 style="margin:0">FreeCreator runs on a computer</h2><p class="st-hint">Using phones as cameras is switched on for a few team accounts only. Open FreeCreator Online on a laptop or desktop instead.</p><p><a class="st-btn" href="/me" style="text-decoration:none">Back to the church app</a></p></div>`;
  await new Promise(() => {});
}
const H = { "Content-Type": "application/json", "x-scc-admin": "1" };
let facing = "environment", stream = null, pc = null, wake = null;
const say = (m) => { $("pcMsg").textContent = m; };
const state = (t, live) => { $("pcState").textContent = t; $("pcState").className = `st-pill${live ? " live" : ""}`; $("pcTag").textContent = live ? "LIVE TO STUDIO" : "PREVIEW"; };
async function camera() {
  stream?.getTracks().forEach((t) => t.stop());
  const q = Number($("pcQ").value), w = q === 1080 ? 1920 : 1280, h = q === 1080 ? 1080 : 720;
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } }, audio: $("pcAudio").checked ? { echoCancellation: false, noiseSuppression: true } : false });
  $("pcVideo").srcObject = stream;
  if (pc) for (const s of pc.getSenders()) { const t = stream.getTracks().find((x) => x.kind === s.track?.kind); if (t) await s.replaceTrack(t); }
}
try { await camera(); } catch (e) { say(`Allow the camera to use this: ${e.message}`); }
$("pcFlip").onclick = () => { facing = facing === "environment" ? "user" : "environment"; camera().catch((e) => say(e.message)); };
$("pcQ").onchange = () => camera().catch((e) => say(e.message));
$("pcAudio").onchange = () => { if (pc) { say("Disconnect and connect again to change sound."); return; } camera().catch(() => {}); };
async function connect() {
  const code = $("pcCode").value.replace(/\D/g, "");
  if (code.length !== 6) { say("Type the 6-digit code from the Studio."); return; }
  $("pcGo").disabled = true; state("Connecting…");
  pc = new RTCPeerConnection({ bundlePolicy: "max-bundle", iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
  for (const t of stream.getTracks()) {
    const tr = pc.addTransceiver(t, { direction: "sendonly", streams: [stream] });
    if (t.kind === "video") { const p = tr.sender.getParameters(); p.encodings = [{ maxBitrate: Number($("pcQ").value) === 1080 ? 6_000_000 : 3_000_000, maxFramerate: 30 }]; p.degradationPreference = "maintain-framerate"; tr.sender.setParameters(p).catch(() => {}); }
  }
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && r()); setTimeout(r, 3000); });
  const label = `${me.user.given_name || "Phone"}'s ${facing === "user" ? "front" : "back"} camera`;
  const r = await fetch("/api/freecreator/cam/offer", { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify({ code, sdp: pc.localDescription.sdp, label }) }).then((x) => x.json().then((d) => ({ ok: x.ok, ...d })));
  if (!r.ok) { say(r.error || "Couldn't connect."); return reset(); }
  say("Waiting for the Studio to accept…");
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const a = await fetch(`/api/freecreator/cam/answer?id=${r.id}`, { credentials: "same-origin", cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (a?.sdp) {
      await pc.setRemoteDescription({ type: "answer", sdp: a.sdp });
      pc.addEventListener("connectionstatechange", () => {
        const s = pc?.connectionState;
        if (s === "connected") { state("Live to Studio", true); say("Connected. Keep this screen on; the phone stays awake."); }
        if (s === "failed" || s === "disconnected") { state("Connection lost"); say("Lost the Studio. Check both are on good internet (same Wi-Fi works best), then connect again."); }
      });
      try { wake = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
      $("pcGo").textContent = "Disconnect"; $("pcGo").classList.add("stop"); $("pcGo").disabled = false; $("pcGo").onclick = reset;
      return;
    }
  }
  say("The Studio didn't answer. Is the Studio open with that code?"); reset();
}
function reset() { pc?.close(); pc = null; wake?.release?.(); state("Not connected"); $("pcGo").textContent = "Connect to Studio"; $("pcGo").classList.remove("stop"); $("pcGo").disabled = false; $("pcGo").onclick = connect; }
$("pcGo").onclick = connect;
document.addEventListener("visibilitychange", async () => { if (!document.hidden && pc && !wake) try { wake = await navigator.wakeLock?.request("screen"); } catch { /* */ } });
