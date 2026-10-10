// Switching between the member view (/me) and the admin workspace (/admin) for people with an admin role.
// A short, calm transition covers the page change while the other side loads its data.
const KEY = "scc-switch";
const LABEL = { admin: "Opening your admin workspace…", member: "Switching to your member profile…" };

function veil(to) {
  let v = document.getElementById("switch-veil");
  if (!v) {
    v = document.createElement("div"); v.id = "switch-veil"; v.setAttribute("role", "status");
    v.innerHTML = '<div class="sv-mark"><i></i><i></i></div><p></p>';
    document.documentElement.appendChild(v);
  }
  v.querySelector("p").textContent = LABEL[to] || "One moment…";
  return v;
}

/** Start a switch: show the veil, then go. */
export function switchTo(to) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ to, at: Date.now() })); } catch { /* fine */ }
  veil(to).classList.add("in");
  setTimeout(() => { location.href = to === "admin" ? "/admin/?switch=1" : "/me"; }, 320);
}

/** The new page is ready: fade the veil out (kept up at least briefly so it never flickers). */
export function switchReady() {
  const v = document.getElementById("switch-veil");
  let at = 0;
  try { at = JSON.parse(sessionStorage.getItem(KEY) || "{}").at || 0; sessionStorage.removeItem(KEY); } catch { /* fine */ }
  if (!v) return;
  const wait = Math.max(0, 650 - (Date.now() - at));
  setTimeout(() => { v.classList.add("out"); setTimeout(() => v.remove(), 380); }, wait);
}

/** Was this page opened by a switch? */
export function arrivedBySwitch(to) {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); return !!s && (!to || s.to === to); } catch { return false; }
}

// Any element with data-switch="admin|member" starts a switch.
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-switch]");
  if (!b) return;
  e.preventDefault();
  switchTo(b.dataset.switch);
});
