// "Get the app": detect the device + browser and show the right way to install the site (PWA).
// Android/desktop Chromium browsers get a real one-tap Install button (beforeinstallprompt);
// iPhone/iPad browsers get step-by-step Add to Home Screen guides; in-app browsers
// (Instagram, Facebook, TikTok…) are told to open the page in Safari/Chrome first.
import { icon } from "./icons.js";

const ua = navigator.userAgent || "";
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const inApp = /FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|TikTok|Line\/|Snapchat|Twitter|LinkedInApp|Pinterest/i.test(ua);
const browser =
  inApp ? (/Instagram/i.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook" : /musical_ly|Bytedance|TikTok/i.test(ua) ? "TikTok" : "an in-app browser")
  : isIOS ? (/CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /EdgiOS/.test(ua) ? "Edge" : /OPiOS|OPT\//.test(ua) ? "Opera" : "Safari")
  : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
  : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "your browser";
const device = isIOS ? (/iPad/.test(ua) || (navigator.platform === "MacIntel") ? "iPad" : "iPhone") : isAndroid ? "Android phone" : "computer";
export const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

let deferred = null;
const listeners = new Set();
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); try { localStorage.setItem("scc-installed", "1"); } catch { /* private mode */ } });
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferred = null;
  return outcome === "accepted";
}
export const onInstallChange = (f) => listeners.add(f);

const step = (n, html) => `<li><span class="n">${n}</span><div>${html}</div></li>`;
const key = (ic, label) => `<span class="key">${icon(ic)}${label ? ` ${label}` : ""}</span>`;
const GUIDES = {
  "ios-safari": { title: "iPhone or iPad · Safari", steps: [`Tap ${key("iosShare", "Share")} at the bottom of the screen (top right on iPad).`, `Scroll down and tap ${key("plusSquare", "Add to Home Screen")}.`, `Make sure <b>Open as Web App</b> is on, then tap <b>Add</b>.`] },
  "ios-chrome": { title: "iPhone or iPad · Chrome", steps: [`Tap ${key("iosShare", "Share")} in the address bar (top right).`, `Tap ${key("plusSquare", "Add to Home Screen")}. If you don't see it, tap <b>More</b> first.`, `Tap <b>Add</b>.`] },
  "ios-other": { title: "iPhone or iPad · Firefox, Edge or Opera", steps: [`Open the browser menu ${key("menu")} and tap ${key("iosShare", "Share")}.`, `Tap ${key("plusSquare", "Add to Home Screen")}.`, `Tap <b>Add</b>. (If it isn't listed, open this page in Safari instead.)`] },
  "android-chrome": { title: "Android · Chrome", steps: [`Tap the menu ${key("moreVertical")} at the top right.`, `Tap <b>Install app</b> (or <b>Add to Home screen</b> → <b>Install</b>).`, `Tap <b>Install</b>. The app appears on your home screen.`] },
  "android-samsung": { title: "Android · Samsung Internet", steps: [`Tap the menu ${key("menu")} at the bottom right.`, `Tap <b>Add page to</b> → <b>Home screen</b>.`, `Tap <b>Add</b>.`] },
  "android-firefox": { title: "Android · Firefox", steps: [`Tap the menu ${key("moreVertical")}.`, `Tap <b>Add app to Home screen</b> (or <b>Install</b>).`, `Tap <b>Add</b>.`] },
  "desktop": { title: "Computer · Chrome or Edge", steps: [`Click the install icon ${key("download")} at the right of the address bar.`, `Or open the browser menu and choose <b>Install Sandton City Church</b> (Edge: <b>Apps → Install this site as an app</b>).`, `Click <b>Install</b>.`] },
  "mac-safari": { title: "Mac · Safari", steps: [`In the menu bar, choose <b>File</b> → <b>Add to Dock</b>.`, `Click <b>Add</b>. The app opens from your Dock.`] },
};
const guideKey = () => isIOS ? (browser === "Safari" ? "ios-safari" : browser === "Chrome" ? "ios-chrome" : "ios-other")
  : isAndroid ? (browser === "Samsung Internet" ? "android-samsung" : browser === "Firefox" ? "android-firefox" : "android-chrome")
  : browser === "Safari" ? "mac-safari" : "desktop";
const renderGuide = (k) => `<ol class="install-steps">${GUIDES[k].steps.map((s, i) => step(i + 1, s)).join("")}</ol>`;

function inAppHtml() {
  const target = isIOS ? "Safari" : "Chrome";
  return `<div class="notice">You're viewing this inside <b>${browser}</b>, which can't install apps.</div>
    <ol class="install-steps">${step(1, `Tap ${key("moreVertical")} or ${key("iosShare")} in ${browser}.`)}${step(2, `Choose <b>Open in ${isIOS ? "external browser" : "browser"}</b> (or <b>Open in ${target}</b>).`)}${step(3, `Then come back to this page and follow the steps for ${target}.`)}</ol>
    <button class="btn btn-sm" type="button" data-copy-link>${icon("copy")} Copy link to open in ${target}</button>`;
}

/** Renders the right instructions (or the Install button) into a container. */
export function renderInstall(el, { compact = false } = {}) {
  const draw = () => {
    if (installed()) { el.innerHTML = `<div class="notice ok">${icon("check")} You're using the app. Welcome home!</div>`; return; }
    if (inApp) { el.innerHTML = inAppHtml(); }
    else if (canPrompt()) {
      el.innerHTML = `<button class="btn btn-gold btn-install" type="button" data-install>${icon("download")} Install the app</button><p class="hint">One tap. It adds Sandton City Church to your ${device === "computer" ? "computer" : "home screen"}.</p>`;
    } else {
      const k = guideKey();
      el.innerHTML = (compact ? "" : `<p class="guide-title">${GUIDES[k].title}</p>`) + renderGuide(k) +
        (isIOS && browser !== "Safari" && compact ? `<p class="hint">Tip: it's quickest in Safari.</p>` : "");
    }
    el.querySelector("[data-install]")?.addEventListener("click", async () => { if (await promptInstall()) draw(); });
    el.querySelector("[data-copy-link]")?.addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(location.origin + "/app"); e.currentTarget.textContent = "Link copied ✓"; } catch { prompt("Copy this link:", location.origin + "/app"); }
    });
  };
  draw(); onInstallChange(draw);
}

// /app page
const detected = document.getElementById("app-detected");
if (detected) {
  document.getElementById("app-device").textContent = installed() ? "App installed" : `Looks like you're on ${device === "computer" ? "a computer" : `an ${device}`}`;
  document.getElementById("app-browser").textContent = inApp ? `Opened inside ${browser}` : `Browser: ${browser}`;
  renderInstall(document.getElementById("app-guide"));
  document.getElementById("app-all").innerHTML = Object.entries(GUIDES).map(([k, g]) => `<div class="guide"><p class="guide-title">${g.title}</p>${renderGuide(k)}</div>`).join("");
}

// Gentle install tip on phones (not on /app, not when installed, not if dismissed recently).
async function maybeBanner() {
  const { consentGiven, functionalAllowed } = await import("./consent.js");
  if (!consentGiven()) { addEventListener("scc:consent", () => setTimeout(maybeBanner, 4000), { once: true }); return; }
  if (!functionalAllowed()) return;
  if (detected || installed() || !(isIOS || isAndroid) || document.body.classList.contains("admin")) return;
  try {
    const until = Number(localStorage.getItem("scc-app-tip") || 0);
    if (until > Date.now()) return;
    const views = Number(sessionStorage.getItem("scc-views") || 0) + 1;
    sessionStorage.setItem("scc-views", String(views));
    if (views < 2 && !canPrompt()) return;
  } catch { /* storage blocked: still show */ }
  const bar = document.createElement("div");
  bar.className = "app-tip";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-label", "Get the app");
  bar.innerHTML = `<img src="/assets/logo-64.png" alt="" width="40" height="40"><div><b>Get the SCC app</b><span>${inApp ? `Open in ${isIOS ? "Safari" : "Chrome"} to install` : "Add it to your home screen in seconds"}</span></div>
    <a class="btn btn-gold btn-sm" href="/app" data-tip-go>${canPrompt() ? "Install" : "How?"}</a><button class="icon-btn" type="button" aria-label="Not now" data-tip-close>${icon("x")}</button>`;
  document.body.append(bar);
  requestAnimationFrame(() => bar.classList.add("show"));
  const close = (days) => { bar.classList.remove("show"); setTimeout(() => bar.remove(), 300); try { localStorage.setItem("scc-app-tip", String(Date.now() + days * 864e5)); } catch { /* ignore */ } };
  bar.querySelector("[data-tip-close]").addEventListener("click", () => close(14));
  bar.querySelector("[data-tip-go]").addEventListener("click", async (e) => { if (canPrompt()) { e.preventDefault(); const ok = await promptInstall(); close(ok ? 365 : 3); } });
}
setTimeout(maybeBanner, 2500);
onInstallChange(() => { if (canPrompt()) { const go = document.querySelector("[data-tip-go]"); if (go) go.textContent = "Install"; } });

// Footer / menu "Get the app" links: hide once installed.
if (installed()) document.querySelectorAll("[data-app-link]").forEach((a) => a.hidden = true);
