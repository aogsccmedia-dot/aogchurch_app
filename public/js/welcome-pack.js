// Welcome pack viewer: readable in the app or browser, easy to share, easy to close.
import { toast } from "./site.js";

const url = `${location.origin}/welcome-pack`;
document.getElementById("wp-close").addEventListener("click", () => {
  // Back to wherever they came from on this site; otherwise their Home.
  if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) history.back();
  else location.href = "/me";
});
document.getElementById("wp-share").addEventListener("click", async () => {
  const data = { title: "AOG Sandton City Church · Welcome pack", text: "Who we are: from Azusa Street to Nicholas Bhengu and the birth of AOG Sandton City Church.", url };
  try {
    // Phones can share the PDF itself; otherwise share the link.
    const file = await fetch("/assets/welcome-pack.pdf").then((r) => r.blob()).then((b) => new File([b], "AOG-Sandton-City-Church-Welcome-Pack.pdf", { type: "application/pdf" })).catch(() => null);
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ ...data, files: [file] });
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(url); toast("Link copied. Paste it anywhere to share.");
  } catch (e) { if (e?.name !== "AbortError") { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url, 6000); } } }
});
addEventListener("keydown", (e) => { if (e.key === "Escape") document.getElementById("wp-close").click(); });
