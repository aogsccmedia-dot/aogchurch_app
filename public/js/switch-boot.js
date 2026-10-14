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

// Signed in? You're in the app: the portal bar replaces the website menus from the very first paint, and the
// website's own pages send you to your Home. The way back to the website is signing out.
(function () {
  try {
    var raw = localStorage.getItem("scc-me");
    if (!raw) return;
    document.documentElement.classList.add("signed-in");
    var me = JSON.parse(raw) || {};
    var p = location.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
    var WEBSITE = ["/", "/index", "/about", "/our-story", "/beliefs", "/events", "/get-involved", "/visit", "/tools", "/presenter", "/app", "/payments"];
    if (WEBSITE.indexOf(p) !== -1) {
      document.documentElement.style.visibility = "hidden";
      location.replace(me.admin_account ? "/admin/" : "/me" + (p === "/events" ? "#upcoming" : ""));
    }
  } catch (e) { /* storage blocked: the site works as normal */ }
})();

// Keep the screen still under fingers: no pinch-zoom or double-tap zoom wobble (iPhone ignores CSS for this).
(function () {
  var stop = function (e) { e.preventDefault(); };
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });
  document.addEventListener("touchmove", function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
})();
