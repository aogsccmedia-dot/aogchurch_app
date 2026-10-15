// FreeCreator Online: the browser version of the desktop app's bridge (window.scc).
// Your library (songs, shows, media) is saved in this browser, per account. Outputs open as browser windows
// (drag one to the projector and press F11), fed live from this window. Sign-in is required.
// Desktop-only features (ATEM, OBS, recording, phone remote, updates, folder import) say so politely.
import { tidyLocally, topicLocally, sermonLocally } from "./ai-local.js";
import { parseReference, formatReference } from "./shared/scripture.js";

const DESKTOP_ONLY = "That's in the FreeCreator desktop app (Windows & Mac).";

// ---- Sign-in gate
const me = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
if (!me?.user) { location.replace("/freecreator?signin=1"); await new Promise(() => {}); }
const uid = me.user.id;
// Church workspace: FreeCreator is strictly for members of a registered church, and each church only sees its own work.
const access = await fetch("/api/freecreator/access", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
if (!access.church) { location.replace("/freecreator?nochurch=1"); await new Promise(() => {}); }
const church = access.church;
// Phones: FreeCreator itself runs on a computer. A few allowed accounts can use their phone as an extra camera.
if (matchMedia("(pointer: coarse) and (max-width: 900px)").matches) {
  location.replace(access.mobile ? "/freecreator/app/camera.html" : "/freecreator?phone=1"); await new Promise(() => {});
}
document.documentElement.dataset.web = "1";

// ---- Library: localStorage (words) + IndexedDB (media files), per account
const KEY = `freecreator:${church.id}:${uid}:lib`;
const DEFAULTS = { songs: [], shows: [], media: [], settings: { themeId: "classic", outputDisplay: null, stageDisplay: null, translation: "kjv", maxLines: 4, logoSrc: null, remotePin: null, customThemes: [], setupDone: false } };
let db; try { db = { ...structuredClone(DEFAULTS), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; db.settings = { ...DEFAULTS.settings, ...db.settings }; } catch { db = structuredClone(DEFAULTS); }
// Songs and shows are shared with everyone in the church workspace (saved on the server); settings and media files stay on this computer.
const SHARED = ["songs", "shows"];
const H = { "Content-Type": "application/json", "x-scc-admin": "1" };
let libAt = 0, here = [];
async function pull(first = false) {
  const r = await fetch(`/api/freecreator/lib?since=${libAt}`, { credentials: "same-origin", cache: "no-store" }).then((x) => x.json()).catch(() => null);
  if (!r?.ok) return false;
  here = r.here || []; window.__fcDrawBar?.();
  let changed = false;
  for (const it of r.items) {
    if (!SHARED.includes(it.coll)) continue;
    db[it.coll] = db[it.coll].filter((x) => x.id !== it.id);
    if (!it.deleted && it.item) db[it.coll].push(it.item);
    libAt = Math.max(libAt, it.at); changed = true;
  }
  if (first && !r.items.length) libAt = 0;
  if (changed) { save(); if (!first) dispatchEvent(new Event("fc:lib-changed")); }
  return true;
}
const push = (coll, item, deleted = false) => fetch("/api/freecreator/lib", { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify({ coll, id: item.id, item: deleted ? null : item, deleted }) })
  .then((r) => r.json()).then((r) => { if (!r.ok) throw new Error(r.error); }).catch((e) => toast(`Not saved to your church library: ${e.message || "no connection"}. It's kept on this computer.`));
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast("This browser is out of space for your library. Remove some media or shows."); } };
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function toast(msg) { import("./control/ui.js").then((m) => m.toast(msg, "info", 5000)).catch(() => alert(msg)); }

const idb = new Promise((ok, no) => { const r = indexedDB.open(`freecreator-${uid}`, 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const tx = async (mode, fn) => { const d = await idb; return new Promise((ok, no) => { const t = d.transaction("files", mode); const req = fn(t.objectStore("files")); t.oncomplete = () => ok(req?.result); t.onerror = () => no(t.error); }); };
const urls = new Map();
async function loadMedia() { for (const m of db.media) { const blob = await tx("readonly", (s) => s.get(m.id)).catch(() => null); if (blob) urls.set(m.id, URL.createObjectURL(blob)); } }
await loadMedia().catch(() => {});
window.__fcMediaUrl = (id) => urls.get(id) || "";
{ // First load: the church's shared library. Anything only on this computer (from before sharing) is shared once.
  const localOnly = { songs: [...db.songs], shows: [...db.shows] };
  db.songs = []; db.shows = [];
  if (await pull(true)) {
    for (const c of SHARED) for (const it of localOnly[c]) if (!db[c].some((x) => x.id === it.id)) { db[c].push(it); push(c, it); }
  } else { db.songs = localOnly.songs; db.shows = localOnly.shows; }
  save();
  setInterval(() => { if (!document.hidden) pull(); }, 6000);
}

// ---- Live state: this window is the source; output and stage windows listen
const live = { listeners: new Set(), state: { themeId: db.settings.themeId, background: { type: "theme" }, blackout: false, clear: false, logo: false, item: {}, version: 0 } };
const bus = new BroadcastChannel("freecreator-live");
const broadcast = () => bus.postMessage({ type: "state", state: live.state });
bus.onmessage = (e) => { if (e.data?.type === "hello") broadcast(); };
const sub = (set) => (cb) => { set.add(cb); return () => set.delete(cb); };

// ---- Screens: browser windows
const wins = { output: null, stage: null };
const screens = { listeners: new Set() };
const DEFAULT_OUTPUTS = [{ id: "main", name: "Projector", mode: "full", displayId: null, enabled: true }, { id: "stage", name: "Stage screen", mode: "stage", displayId: null, enabled: true }];
// Screens: with the browser's window-management permission (Chrome / Edge) every connected screen is listed
// by name, including an ATEM or capture device fed by HDMI, and output windows open on the right one.
let screenDetails = null;
async function detectScreens(ask) {
  if (!("getScreenDetails" in window)) return false;
  if (!ask) { const p = await navigator.permissions.query({ name: "window-management" }).catch(() => null); if (p?.state !== "granted") return false; }
  try { screenDetails = await window.getScreenDetails(); screenDetails.onscreenschange = emitScreens; emitScreens(); return true; } catch { return false; }
}
detectScreens(false);
const displayList = () => screenDetails?.screens?.length
  ? screenDetails.screens.map((sc, i) => ({ id: i + 1, label: `${sc.label || `Screen ${i + 1}`}${/atem|blackmagic/i.test(sc.label) ? " (ATEM)" : ""}${sc === screenDetails.currentScreen ? " (this one)" : ""}`, primary: sc.isPrimary, internal: sc.isInternal, width: sc.width, height: sc.height, scale: sc.devicePixelRatio, pixelsWide: Math.round(sc.width * sc.devicePixelRatio), pixelsHigh: Math.round(sc.height * sc.devicePixelRatio), hz: 60, colorDepth: sc.colorDepth, atem: /atem|blackmagic/i.test(sc.label) }))
  : [{ id: 1, label: "This screen", primary: true, internal: true, width: screen.width, height: screen.height, scale: devicePixelRatio, pixelsWide: Math.round(screen.width * devicePixelRatio), pixelsHigh: Math.round(screen.height * devicePixelRatio), hz: 60, colorDepth: screen.colorDepth }];
function screensState() {
  for (const k of Object.keys(wins)) if (wins[k]?.closed) wins[k] = null;
  return { output: !!wins.output, stage: !!wins.stage, open: Object.keys(wins).filter((k) => wins[k]), outputs: db.settings.outputs || DEFAULT_OUTPUTS, displays: displayList() };
}
/** Where an output goes: the screen chosen in Setup, else an ATEM input, else any screen that isn't this one. */
function targetScreen(o) {
  const list = screenDetails?.screens || []; if (list.length < 2) return null;
  if (o?.displayId && list[o.displayId - 1]) return list[o.displayId - 1];
  return list.find((sc) => /atem|blackmagic/i.test(sc.label)) || list.find((sc) => sc !== screenDetails.currentScreen) || null;
}
const emitScreens = () => { const s = screensState(); for (const cb of screens.listeners) cb(s); };
setInterval(() => { const before = JSON.stringify([!!wins.output, !!wins.stage]); screensState(); if (JSON.stringify([!!wins.output, !!wins.stage]) !== before) emitScreens(); }, 1500);
function openWindow(kind) {
  const outs = (db.settings.outputs || DEFAULT_OUTPUTS).filter((o) => o.enabled !== false && (kind === "stage" ? o.mode === "stage" : o.mode !== "stage"));
  if (!outs.length) return { count: 0 };
  const o = outs[0];
  const url = kind === "stage" ? "/freecreator/app/web/stage.html" : `/freecreator/app/web/output.html?mode=${encodeURIComponent(o.mode || "full")}`;
  const sc = targetScreen(o);
  const feat = sc ? `popup,left=${sc.availLeft},top=${sc.availTop},width=${sc.availWidth},height=${sc.availHeight},fullscreen` : "popup,width=960,height=540";
  const w = window.open(url, `freecreator-${kind}`, feat);
  if (!w) throw new Error("Your browser blocked the window. Allow pop-ups for this site, then try again.");
  wins[kind] = w; setTimeout(broadcast, 600); emitScreens();
  return { ok: true, windowed: true, count: 1 };
}

const desk = { listeners: new Set(), emit() { const open = !!wins.studio && !wins.studio.closed; for (const cb of this.listeners) cb(open); } };
setInterval(() => desk.emit(), 2000);

// ---- Files: the browser's own picker
function pick(accept, multiple = true) {
  return new Promise((ok) => { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = multiple; i.onchange = () => ok([...i.files]); i.oncancel = () => ok([]); i.click(); });
}
const pending = new Map();   // dropped files waiting to be added as media
const kindOf = (f) => (/^image\//.test(f.type) ? "image" : /^video\//.test(f.type) ? "video" : /^audio\//.test(f.type) ? "audio" : null);

// ---- AI: the church's own Workers AI, with the desktop app's offline rules as the fallback
async function askAI(task, text) {
  try {
    const r = await fetch("/api/freecreator/ai", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-scc-admin": "1" }, body: JSON.stringify({ task, text }) });
    const d = await r.json(); return r.ok && d.ok ? d.text : null;
  } catch { return null; }
}
const jsonFrom = (t) => { if (!t) return null; const m = t.match(/[[{][\s\S]*[\]}]/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

window.scc = {
  lib: {
    get: async (n) => structuredClone(db[n]),
    upsert: async (n, item) => { const it = { ...item, id: item.id || newId(), updatedAt: Date.now() }; db[n] = db[n].filter((x) => x.id !== it.id).concat(it); save(); if (SHARED.includes(n)) push(n, it); return it; },
    remove: async (n, i) => { db[n] = db[n].filter((x) => x.id !== i); if (SHARED.includes(n)) push(n, { id: i }, true); if (n === "media") { tx("readwrite", (s) => s.delete(i)).catch(() => {}); const u = urls.get(i); if (u) URL.revokeObjectURL(u); urls.delete(i); } save(); return true; },
    setSettings: async (p) => { db.settings = { ...db.settings, ...p }; save(); return structuredClone(db.settings); },
  },
  live: {
    get: async () => live.state,
    set: async (p) => { live.state = { ...live.state, ...p, version: live.state.version + 1 }; broadcast(); for (const cb of live.listeners) cb(live.state); return live.state; },
    onState: sub(live.listeners),
  },
  remote: { setView: async () => true, onCommand: () => () => {} },
  screens: {
    get: async () => screensState(),
    open: async (k) => {
      const r = openWindow(k || "output");   // open straight away (the click still counts), then move it once screens are known
      if (!screenDetails) detectScreens(true).then((ok) => {
        const w = wins[k || "output"], o = (db.settings.outputs || DEFAULT_OUTPUTS).find((x) => (k === "stage") === (x.mode === "stage")), sc = ok && targetScreen(o);
        if (w && sc) { try { w.moveTo(sc.availLeft, sc.availTop); w.resizeTo(sc.availWidth, sc.availHeight); } catch { /* user can drag it */ } }
      });
      return r;
    },
    detect: async () => detectScreens(true),
    close: async (k) => { try { wins[k]?.close(); } catch { /* */ } wins[k] = null; emitScreens(); return true; },
    identify: async () => true, onChange: sub(screens.listeners),
  },
  media: {
    add: async (paths) => {
      let files = Array.isArray(paths) && paths.length ? paths.map((p) => pending.get(p)).filter(Boolean) : await pick("image/*,video/*,audio/*");
      const added = [];
      for (const f of files) {
        const type = kindOf(f); if (!type) continue;
        if (f.size > 400 * 1024 * 1024) { toast(`${f.name} is too big for the browser. Use the desktop app for large videos.`); continue; }
        const item = { id: newId(), name: f.name.replace(/\.[^.]+$/, ""), type, web: true, size: f.size };
        try { await tx("readwrite", (s) => s.put(f, item.id)); } catch { toast("This browser couldn't store that file (out of space?)."); continue; }
        urls.set(item.id, URL.createObjectURL(f)); db.media.push(item); added.push(item);
      }
      pending.clear(); save(); return added;
    },
    reveal: async () => { toast(DESKTOP_ONLY); return false; },
    pathFor: (file) => { const k = `web:${newId()}`; pending.set(k, file); return k; },
  },
  files: {
    open: async (kind) => {
      const accept = { songs: ".show,.xml,.txt,.json", show: ".sccshow", text: ".txt,.md" }[kind] || "";
      const files = await pick(accept);
      return Promise.all(files.filter((f) => f.size < 80 * 1024 * 1024).map(async (f) => ({ name: f.name, ext: (f.name.match(/\.[^.]+$/)?.[0] || "").toLowerCase(), text: await f.text() })));
    },
  },
  shows: {
    exportFile: async (showId) => {
      const show = db.shows.find((s) => s.id === showId); if (!show) throw new Error("Show not found");
      const songIds = new Set((show.items || []).map((i) => i.songId).filter(Boolean));
      const pkg = { format: "sccshow", version: 1, show, songs: db.songs.filter((s) => songIds.has(s.id)), media: [] };
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: "application/json" }));
      a.download = `${(show.title || "Show").replace(/[\\/:*?"<>|]+/g, "-")}.sccshow`; document.body.append(a); a.click(); a.remove();
      return a.download;
    },
    importText: async (text) => {
      const pkg = JSON.parse(text); if (!pkg?.show) throw new Error("That isn't a FreeCreator show file.");
      for (const s of pkg.songs || []) if (!db.songs.some((x) => x.id === s.id)) db.songs.push(s);
      const show = { ...pkg.show, id: db.shows.some((x) => x.id === pkg.show.id) ? newId() : pkg.show.id };
      db.shows.push(show); save(); push("shows", show); for (const sg of pkg.songs || []) push("songs", sg); return show;
    },
    fetchLan: async () => { throw new Error(DESKTOP_ONLY); },
  },
  bible: {
    lookup: async (input, tr = "kjv") => {
      const ref = parseReference(input); if (!ref) throw new Error("Try a reference like John 3:16 or Psalm 23.");
      const r = await fetch(`/api/freecreator/bible?ref=${encodeURIComponent(formatReference(ref))}&tr=${encodeURIComponent(tr)}`, { credentials: "same-origin" });
      const d = await r.json(); if (!r.ok || !d.ok) throw new Error(d.error || "Couldn't reach the Bible service.");
      return { ref, reference: d.reference, translation: d.translation, verses: d.verses };
    },
    translations: async () => [{ id: "kjv", name: "King James Version" }, { id: "web", name: "World English Bible" }, { id: "asv", name: "American Standard Version" }, { id: "bbe", name: "Bible in Basic English" }, { id: "ylt", name: "Young's Literal Translation" }],
  },
  ai: {
    status: async () => ({ provider: "cloudflare", hasKey: true, hasCfToken: true, secure: true, web: true, localUrl: "", localModel: "", cfAccount: "Sandton City Church", cfModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }),
    setKey: async () => ({ ok: true }), config: async () => window.scc.ai.status(),
    test: async () => { const t = await askAI("test", "ready?"); return t ? { ok: true, message: "Connected to the church's open-source AI." } : { ok: true, message: "The AI is resting. Built-in rules will help instead." }; },
    tidy: async (t) => { const out = await askAI("tidy", t); return out && /\[[^\]]+\]/.test(out) ? { text: out.replace(/^```\w*\n?|```$/g, "").trim(), ai: true } : { text: tidyLocally(t), ai: false }; },
    scriptures: async (topic) => {
      const out = jsonFrom(await askAI("scriptures", topic));
      const items = Array.isArray(out) ? out.map((x) => ({ ref: parseReference(x.ref) ? formatReference(parseReference(x.ref)) : null, why: String(x.why || "") })).filter((x) => x.ref) : [];
      return items.length ? { items, ai: true } : { items: topicLocally(topic), ai: false };
    },
    sermon: async (notes) => {
      const out = jsonFrom(await askAI("sermon", notes));
      const slides = Array.isArray(out) ? out.map((s) => ({ kind: s.kind === "scripture" ? "scripture" : "text", text: String(s.text || ""), ref: s.ref || null })).filter((s) => s.text || s.ref) : [];
      return slides.length ? { slides, ai: true } : { slides: sermonLocally(notes), ai: false };
    },
  },
  updates: { ring: async () => ({ status: "current" }), check: async () => ({ status: "current", message: "FreeCreator Online is always the latest version." }), get: async () => ({ status: "idle" }), install: async () => true, onStatus: () => () => {} },
  server: { info: async () => ({ ok: false, web: true, message: DESKTOP_ONLY, addresses: [], clients: 0 }), newPin: async () => { throw new Error(DESKTOP_ONLY); } },
  app: { info: async () => ({ version: "online", platform: "browser", web: true }), system: async () => ({ os: navigator.userAgent, cores: navigator.hardwareConcurrency || 0, memoryGB: navigator.deviceMemory || 0, gpu: [] }), open: async (u) => window.open(u, "_blank", "noopener"), openData: async () => { toast(DESKTOP_ONLY); return false; } },
  beta: { feedback: async (d) => { await fetch("/api/presenter/feedback", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-scc-admin": "1" }, body: JSON.stringify({ ...d, source: "online" }) }).catch(() => {}); return true; } },
  outputs: { set: async (list) => { db.settings.outputs = list; save(); emitScreens(); return screensState(); } },
  desk: {
    open: async () => {
      if (wins.studio && !wins.studio.closed) { wins.studio.focus(); return true; }
      const w = window.open("/freecreator/app/studio.html", "freecreator-studio", "popup,width=1400,height=860");
      if (!w) throw new Error("Your browser blocked the Studio window. Allow pop-ups for this site, then try again.");
      wins.studio = w; desk.emit(); return true;
    },
    onChange: (cb) => { desk.listeners.add(cb); return () => desk.listeners.delete(cb); },
  },
  atem: { get: async () => ({ connected: false, status: "off", web: true }), connect: async () => { throw new Error(DESKTOP_ONLY); }, disconnect: async () => true, action: async () => { throw new Error(DESKTOP_ONLY); }, setupCable: async () => { throw new Error(DESKTOP_ONLY); }, setupNet: async () => { throw new Error(DESKTOP_ONLY); }, stopAuto: async () => true, onState: () => () => {} },
  rec: { start: async () => { throw new Error(DESKTOP_ONLY); }, chunk: async () => true, stop: async () => "", reveal: async () => true },
  importer: { start: async () => { throw new Error(DESKTOP_ONLY); }, get: async () => ({ status: "idle" }), cancel: async () => ({ status: "cancelled" }), freeshow: async () => ({ folders: [], shows: 0 }), pickFolder: async () => [], pickFiles: async () => [], onProgress: () => () => {} },
  onMenu: () => () => {},
};

// A slim bar so people know where they are and can get back to the church app.
const bar = document.createElement("div");
bar.className = "fc-web-bar";
const clean = (t) => String(t || "").replace(/[<>&"]/g, "");
function drawBar() {
  bar.innerHTML = `<b>FreeCreator Online</b><span>${clean(church.name)} · ${clean(me.user.given_name || me.user.email)}${here.length ? ` · also here: ${here.slice(0, 4).map(clean).join(", ")}${here.length > 4 ? ` +${here.length - 4}` : ""}` : ""} · songs and shows are shared with your church</span><a href="/freecreator">Help</a><a href="/me">Church app</a>`;
}
drawBar(); window.__fcDrawBar = drawBar;
const style = document.createElement("style");
style.textContent = `@font-face{font-family:"Jost";src:url("/fonts/Jost.woff") format("woff");font-weight:100 900;font-display:swap}html,body{overscroll-behavior:none}.fc-web-bar{position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:14px;align-items:center;height:30px;padding:0 14px;font:500 12.5px/1 "Jost",system-ui,sans-serif;background:rgba(10,10,14,.92);color:#cfcfe0;border-top:1px solid rgba(255,255,255,.08)}.fc-web-bar b{color:#fff}.fc-web-bar span{flex:1;opacity:.8}.fc-web-bar a{color:#ffd27a;text-decoration:none}body{padding-bottom:30px}`;
document.head.append(style);
addEventListener("DOMContentLoaded", () => document.body.append(bar));
if (document.readyState !== "loading") document.body.append(bar);
addEventListener("beforeunload", () => { for (const w of Object.values(wins)) try { w?.close(); } catch { /* */ } });
