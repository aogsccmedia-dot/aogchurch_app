// Document viewer (welcome pack, Good News pamphlet): readable in the app or browser, easy to share, easy to close.
// Settings come from data attributes on <main>: data-url, data-pdf, data-name, data-title, data-text, data-back.
import { toast } from "./site.js";

const m = document.querySelector("main[data-pdf]") || document.querySelector("main");
const cfg = { url: location.origin + (m.dataset.url || location.pathname), pdf: m.dataset.pdf || "/assets/welcome-pack.pdf", name: m.dataset.name || "AOG-Sandton-City-Church-Welcome-Pack.pdf",
  title: m.dataset.title || "AOG Sandton City Church · Welcome pack", text: m.dataset.text || "Who we are: from Azusa Street to Nicholas Bhengu and the birth of AOG Sandton City Church.", back: m.dataset.back || "/me" };
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pdfFile = () => fetch(cfg.pdf).then((r) => r.blob()).then((b) => new File([b], cfg.name, { type: "application/pdf" })).catch(() => null);

function goBack() {
  // Back to wherever they came from on this site; otherwise the page this document belongs to.
  if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) history.back();
  else location.href = cfg.back;
}
document.getElementById("wp-close").addEventListener("click", goBack);

async function share() {
  const data = { title: cfg.title, text: cfg.text, url: cfg.url };
  try {
    const file = await pdfFile();   // phones can share the PDF itself; otherwise share the link
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ ...data, files: [file] });
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(cfg.url); toast("Link copied. Paste it anywhere to share.");
  } catch (e) { if (e?.name !== "AbortError") { try { await navigator.clipboard.writeText(cfg.url); toast("Link copied"); } catch { toast(cfg.url, 6000); } } }
}
document.getElementById("wp-share").addEventListener("click", share);
document.querySelectorAll("[data-share-link]").forEach((b) => b.addEventListener("click", async () => {
  try { if (navigator.share) await navigator.share({ title: cfg.title, text: cfg.text, url: cfg.url }); else { await navigator.clipboard.writeText(cfg.url); toast("Link copied"); } } catch { /* cancelled */ }
}));
document.querySelectorAll("[data-copy-link]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(cfg.url); toast("Link copied"); } catch { toast(cfg.url, 6000); } }));
document.querySelectorAll("[data-wa]").forEach((a) => { a.href = `https://wa.me/?text=${encodeURIComponent(`${cfg.title}\n${cfg.text}\n${cfg.url}`)}`; });

// In the installed app a PDF would open full-screen with no way back, so save it through the share sheet instead.
document.querySelectorAll("a[data-pdf-link]").forEach((a) => a.addEventListener("click", async (e) => {
  if (!standalone) return;
  const file = await pdfFile();
  if (file && navigator.canShare?.({ files: [file] })) { e.preventDefault(); try { await navigator.share({ files: [file], title: cfg.title }); } catch { /* cancelled */ } }
}));
addEventListener("keydown", (e) => { if (e.key === "Escape") goBack(); });

// Sit the Back / Share bar right under whichever top bar is showing (website or app), on any screen.
function placeBar() {
  const bar = document.querySelector(".wp-bar"); if (!bar) return;
  const tops = [...document.querySelectorAll(".app-bar, .site-header")].filter((h) => getComputedStyle(h).display !== "none" && ["sticky", "fixed"].includes(getComputedStyle(h).position));
  const h = Math.max(0, ...tops.map((x) => x.offsetHeight));
  bar.style.setProperty("top", `${h}px`, "important");
}
placeBar(); addEventListener("resize", placeBar); setTimeout(placeBar, 400);
