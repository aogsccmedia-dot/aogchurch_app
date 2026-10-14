// Phone notifications for the church app (daily verse by default). We always ask first, kindly, and once.
// iPhone: works when the app has been added to the Home Screen (iOS 16.4+). Android and computers: in the browser too.
const ok = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const KEY = "scc-push-ask";
const xhr = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-scc-admin": "1" }, body: JSON.stringify(body), credentials: "same-origin" });
const b64ToBytes = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

export const pushSupported = ok;
export const needsInstall = () => isIOS() && !standalone();

export async function currentSub() {
  if (!ok()) return null;
  const reg = await navigator.serviceWorker.getRegistration(); return reg ? reg.pushManager.getSubscription() : null;
}

/** Ask permission (must be from a tap) and subscribe. The daily verse is on by default. */
export async function enablePush({ verse = true } = {}) {
  if (!ok()) throw new Error(needsInstall() ? "On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then turn this on." : "This browser can't show notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked. You can allow them in your phone's settings for this app.");
  const reg = await navigator.serviceWorker.ready;
  const { key } = await fetch("/api/push/key").then((r) => r.json());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await xhr("/api/push/subscribe", { subscription: sub.toJSON(), verse });
  try { localStorage.setItem(KEY, "done"); } catch { /* ignore */ }
  return sub;
}
export async function setVerse(on) {
  const sub = await currentSub();
  if (!sub) { if (on) await enablePush({ verse: true }); return; }
  await xhr("/api/push/prefs", { endpoint: sub.endpoint, verse: on });
}
export async function disablePush() {
  const sub = await currentSub(); if (!sub) return;
  await xhr("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe();
}

/** Once, after signing in: a friendly card above the bottom bar. If already allowed, quietly make sure we're subscribed. */
export async function offerOnce() {
  if (!ok() && !needsInstall()) return;
  if (ok() && Notification.permission === "granted") { if (!(await currentSub())) enablePush().catch(() => {}); return; }
  if (ok() && Notification.permission === "denied") return;
  let seen = null; try { seen = localStorage.getItem(KEY); } catch { return; }
  if (seen === "done" || (seen && Date.now() - Number(seen) < 14 * 86400_000)) return;
  if (document.querySelector(".push-offer, .hello-black")) return;
  const el = document.createElement("div");
  el.className = "push-offer"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Daily verse notifications");
  el.innerHTML = needsInstall()
    ? `<span class="po-ico">📖</span><div><b>Get today's verse every morning</b><span>Add the app to your Home Screen (Share → Add to Home Screen), then open it and tap Allow.</span></div><button type="button" class="btn btn-sm" data-po-no>OK</button>`
    : `<span class="po-ico">📖</span><div><b>Get today's verse every morning?</b><span>A gentle notification at 6am. You can turn it off any time in Settings.</span></div><div class="po-btns"><button type="button" class="btn btn-sm btn-gold" data-po-yes>Allow</button><button type="button" class="btn btn-sm btn-ghost" data-po-no>Not now</button></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  const close = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 250); };
  el.querySelector("[data-po-no]").addEventListener("click", () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } close(); });
  el.querySelector("[data-po-yes]")?.addEventListener("click", async () => {
    try { await enablePush(); el.querySelector("div").innerHTML = "<b>You're all set 🙌</b><span>Your first verse arrives tomorrow morning.</span>"; el.querySelector(".po-btns")?.remove(); setTimeout(close, 2200); }
    catch (err) { el.querySelector("div span").textContent = err.message; }
  });
}
