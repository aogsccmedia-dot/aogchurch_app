// One portal for everyone who signs in: Home (tickets, what's coming up, what to know), Devotions, Ask SCC, Vote, Store, Settings; people the main admin has
// given a role also see their Admin (or Youth leader) tab, on the same sign-in, with no switching and no codes.
// After signing in, a short black welcome greets them by name and role.
import { icon } from "./icons.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const roleName = (me) => me?.admin_role === "super" ? "Main admin" : me?.admin_role === "youth" ? "Youth leader" : me?.admin_role ? "Admin" : null;

export function tabsFor(me) {
  const role = roleName(me);
  return [
    !me.admin_account && ["/me", "home", "Home"],
    ["/devotions", "bookOpen", "Devotions"],
    ["/assistant", "sparkles", "Ask SCC"],
    ["/vote", "vote", "Vote"],
    ["/store", "landmark", "Store"],
    role && ["/admin/", "layoutDashboard", me.admin_role === "youth" ? "Leader" : "Admin"],
    ["/settings", "settings", "Settings"],
  ].filter(Boolean);
}

/** Draw the portal tabs into `el` (a <nav>). `active` is the path of the current page. */
export function renderTabs(el, me, active) {
  if (!el || !me?.user) return;
  el.innerHTML = tabsFor(me).map(([href, ico, label]) => `<a href="${href}" class="${href.replace(/\/$/, "") === active.replace(/\/$/, "") ? "on" : ""}"${href.replace(/\/$/, "") === active.replace(/\/$/, "") ? ' aria-current="page"' : ""}>${icon(ico)}<span>${esc(label)}</span></a>`).join("");
  el.hidden = false;
}

/** The black welcome, once per sign-in session: "Welcome back, Thandi · Youth leader portal". Tap to skip. */
export function helloOnce(me) {
  if (!me?.user) return;
  const key = `scc-hello-${me.user.id || me.user.email}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { return; }
  const first = (me.user.given_name || me.user.name || "").split(" ")[0];
  const role = roleName(me);
  const el = document.createElement("div");
  el.className = "hello-black"; el.setAttribute("role", "status");
  el.innerHTML = `<div class="hb-in"><img src="/assets/logo-192.png" alt="" width="64" height="64"><p class="hb-hi">Welcome back${first ? `, <b>${esc(first)}</b>` : ""}</p>
    <p class="hb-role">${role ? `${esc(role)} portal` : "Your church family"}</p><i class="hb-line"></i></div>`;
  document.documentElement.append(el);
  const done = () => { el.classList.add("out"); setTimeout(() => el.remove(), 420); };
  el.addEventListener("click", done);
  setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 700 : 1500);
}
