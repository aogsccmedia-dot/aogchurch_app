// Runs in <head> before the page paints: if we're arriving from a profile switch, keep the
// transition veil up until the new page says it's ready (see switcher.js). Classic script, no imports.
(function () {
  try {
    var raw = sessionStorage.getItem("scc-switch");
    if (!raw) return;
    var s = JSON.parse(raw);
    if (!s || Date.now() - s.at > 20000) { sessionStorage.removeItem("scc-switch"); return; }
    var v = document.createElement("div");
    v.id = "switch-veil"; v.setAttribute("role", "status");
    v.innerHTML = '<div class="sv-mark"><i></i><i></i></div><p></p>';
    v.querySelector("p").textContent = s.label || (s.to === "admin" ? "Opening your admin workspace…" : "Switching to your member profile…");
    document.documentElement.appendChild(v);
    // Never leave anyone stuck behind the veil.
    setTimeout(function () { var x = document.getElementById("switch-veil"); if (x) x.remove(); sessionStorage.removeItem("scc-switch"); }, 8000);
  } catch (e) { /* storage blocked: just load normally */ }
})();
// Keep the page from jumping when the event ticker appears: if we already know there are events to show
// (cached by site.js on an earlier page), reserve the ticker's space before the first paint.
(function () {
  try {
    if (/^\/(admin|me|join|ticket|membership)/.test(location.pathname) || sessionStorage.getItem("ticker-off") === "1") return;
    var c = JSON.parse(sessionStorage.getItem("ticker") || "null");
    if (c && Date.now() - c.at < 120000 && (c.events || []).some(function (e) { return e.registration_open; })) document.documentElement.classList.add("has-ticker");
  } catch (e) { /* ignore */ }
})();
