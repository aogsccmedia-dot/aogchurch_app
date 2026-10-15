// Program window: shows the Studio's finished picture full screen, e.g. on the HDMI output that feeds an ATEM.
const v = document.getElementById("v"), tip = document.getElementById("tip");
const attach = () => { try { const s = window.opener?.__fcProgram?.(); if (s && v.srcObject !== s) { v.srcObject = s; v.play().catch(() => {}); } } catch { /* opener gone */ } };
attach(); setInterval(attach, 2000);
const full = () => document.documentElement.requestFullscreen?.().catch(() => {});
tip.onclick = full; addEventListener("dblclick", full); addEventListener("keydown", (e) => { if (e.key === "f") full(); });
setTimeout(() => { tip.style.opacity = "0"; }, 6000);
addEventListener("mousemove", () => { tip.style.opacity = document.fullscreenElement ? "0" : "1"; });
