// Ask SCC: a simple members' app built around one chat. Quick tiles up top, helpers you can talk to directly,
// event cards with Get Ticket and "add to calendar", and thumbs up/down so the team can see what helps.
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";
import { helloOnce, renderTabs } from "./portal.js";

const root = document.getElementById("ask-root");
const TILES = [
  ["What's happening this week?", "sparkles", "This week"], ["What's on this month?", "calendar", "This month"], ["When are the services?", "clock", "Services"], ["Add church dates to my calendar", "calendarPlus", "Calendar"],
  ["Do I have a ticket?", "ticket", "My tickets"], ["I'd like prayer", "handHeart", "Prayer"],
];
let info = null, agent = null, lastAgent = null, history = [], busy = false;

const calMenu = (c) => `<details class="cal-menu"><summary class="btn btn-sm">${icon("calendarPlus")} Add to calendar</summary><div>
  <a href="${esc(c.google)}" target="_blank" rel="noopener">Google</a><a href="${esc(c.ics)}">iPhone / Apple</a><a href="${esc(c.outlook)}" target="_blank" rel="noopener">Outlook</a></div></details>`;
const card = (c) => c.kind === "event"
  ? `<article class="ask-ev"><div><b>${esc(c.title)}</b><span>${esc(c.when)}${c.where ? ` · ${esc(c.where)}` : ""}${c.price ? ` · ${esc(c.price)}` : ""}</span></div>
      <div class="ask-ev-actions"><a class="btn btn-gold btn-sm btn-glow" href="${esc(c.url)}">${icon("ticket")} Get Ticket</a>${calMenu(c)}</div></article>`
  : `<article class="ask-info"><b>${esc(c.title)}</b><ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></article>`;
const action = (a) => a.href === "#calendar" ? `<button class="btn btn-sm ${a.primary ? "btn-gold" : ""}" data-ask="Add church dates to my calendar">${esc(a.label)}</button>`
  : `<a class="btn btn-sm ${a.primary ? "btn-gold" : ""}" href="${esc(a.href)}"${/^https?:|^webcal:/.test(a.href) ? ' target="_blank" rel="noopener"' : ""}>${esc(a.label)}</a>`;

function bubble(role, html, extra = "") {
  const thread = document.getElementById("ask-thread");
  const el = document.createElement("div");
  el.className = `ask-msg ${role}`;
  el.innerHTML = html + extra;
  thread.append(el);
  // The conversation scrolls inside its own box, so the page (and the buttons around it) never jump.
  const top = role === "bot" && !role.includes("typing") ? el.offsetTop - 8 : thread.scrollHeight;
  thread.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return el;
}

function replyHtml(r, id) {
  return `<span class="ask-who">${icon("bot")} ${esc(r.agent_label)}</span><p>${esc(r.text).replace(/\n/g, "<br>")}</p>
    ${r.cards?.length ? `<div class="ask-cards">${r.cards.map(card).join("")}</div>` : ""}
    ${r.actions?.length ? `<div class="ask-actions">${r.actions.map(action).join("")}</div>` : ""}
    ${r.suggestions?.length ? `<div class="ask-sugg">${r.suggestions.map((s) => `<button data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}
    <div class="ask-rate" data-id="${esc(id)}"><button data-r="1" aria-label="Helpful">${icon("thumbsUp")}</button><button data-r="-1" aria-label="Not helpful">${icon("thumbsDown")}</button></div>`;
}
function renderReply(r, id) { bubble("bot", replyHtml(r, id)); }

/** Read the answer as it's written: meta (cards and buttons) → text pieces → done (final clean text). */
async function streamChat(body, typing) {
  const res = await fetch("/api/assistant/chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-scc-admin": "1" }, body: JSON.stringify({ ...body, stream: true }) });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("event-stream")) {
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) throw new Error(d.error || "Something went wrong. Please try again.");
    return d;   // the built-in answer (AI switched off)
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", meta = null, el = null, p = null, text = "";
  const thread = document.getElementById("ask-thread");
  const stick = () => { if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140) thread.scrollTop = thread.scrollHeight; };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (\w+)/m.exec(chunk)?.[1], data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if (ev === "meta") meta = d;
      else if (ev === "t") {
        if (!el) { typing.remove(); el = bubble("bot", `<span class="ask-who">${icon("bot")} ${esc(meta?.reply?.agent_label || "Ask SCC")}</span><p class="ask-live"></p>`); p = el.querySelector(".ask-live"); }
        text += d.t; p.textContent = text; stick();
      } else if (ev === "done") {
        const reply = { ...(meta?.reply || {}), text: d.text };
        if (el) { el.innerHTML = replyHtml(reply, meta?.id); } else { typing.remove(); renderReply(reply, meta?.id); }
        stick();
        return { id: meta?.id, reply, streamed: true };
      }
    }
  }
  if (el && text) return { id: meta?.id, reply: { ...(meta?.reply || {}), text }, streamed: true };
  throw new Error("The answer was cut off. Please try again.");
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  bubble("me", `<p>${esc(text)}</p>`);
  const typing = bubble("bot typing", `<span class="dots"><i></i><i></i><i></i></span>`);
  const form = document.getElementById("ask-form");
  form.classList.add("sending");
  try {
    const d = await streamChat({ message: text, agent, last_agent: lastAgent, history: history.slice(-6) }, typing);
    if (!d.streamed) { typing.remove(); renderReply(d.reply, d.id); }
    lastAgent = d.reply.agent;
    history.push({ role: "user", content: text }, { role: "assistant", content: d.reply.text });
  } catch (e) {
    typing.remove();
    bubble("bot", `<p>${esc(e.message || "Something went wrong. Please try again.")}</p>`);
  } finally { busy = false; form.classList.remove("sending"); document.getElementById("ask-in").focus({ preventScroll: true }); }
}

function setAgent(id) {
  agent = id || null;
  root.querySelectorAll(".ask-agents button").forEach((b) => b.classList.toggle("on", (b.dataset.agent || null) === agent));
  const a = info.agents.find((x) => x.id === agent);
  document.getElementById("ask-in").placeholder = a ? `Ask the ${a.label} helper…` : "Ask me anything…";
}

async function start() {
  const me = await getMe();
  info = await api("/api/assistant");
  if (!me.user) {
    root.innerHTML = `<section class="vote-card center"><h2>Sign in to chat</h2><p class="muted-text">Ask SCC answers questions about events, services, your tickets and the church calendar.</p><div class="gbtn" id="a-g"></div><a class="btn" href="/me">Sign in</a></section>`;
    googleButton(document.getElementById("a-g"), { text: "signin_with", width: 300 });
    return;
  }
  if (!info.enabled) { root.innerHTML = `<section class="vote-card center"><h2>Ask SCC is resting</h2><p class="muted-text">Please try again a little later.</p></section>`; return; }
  renderTabs(document.getElementById("portal-tabs"), me, "/assistant"); helloOnce(me);
  const first = (me.user.given_name || me.user.name || "").split(" ")[0];
  root.innerHTML = `
    <div class="ask-tiles">${TILES.map(([q, i, l]) => `<button data-ask="${esc(q)}">${icon(i)}<span>${esc(l)}</span></button>`).join("")}</div>
    <nav class="ask-agents" aria-label="Talk to a helper"><span>Talk to</span><button class="on" data-agent="">${icon("sparkles")} Concierge</button>${info.agents.map((a) => `<button data-agent="${esc(a.id)}" title="${esc(a.blurb)}">${esc(a.label)}</button>`).join("")}</nav>
    <div class="ask-thread" id="ask-thread"></div>
    <form class="ask-form" id="ask-form" autocomplete="off"><input id="ask-in" class="input" maxlength="2000" placeholder="Ask me anything…" aria-label="Your question"><button class="btn btn-gold" type="submit" aria-label="Send">${icon("send")}</button></form>
    <p class="fine ask-fine">Answers come from the church's own calendar and your account. Check important details on the event page.</p>`;
  root.addEventListener("click", async (e) => {
    const q = e.target.closest("[data-ask]"); if (q) { e.preventDefault(); return send(q.dataset.ask); }
    const ag = e.target.closest("[data-agent]"); if (ag) return setAgent(ag.dataset.agent);
    const r = e.target.closest(".ask-rate [data-r]");
    if (r) {
      const box = r.parentElement;
      box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === r));
      try { await api("/api/assistant/feedback", { method: "POST", body: { id: box.dataset.id, rating: Number(r.dataset.r) } }); toast("Thanks for the feedback"); } catch { /* ignore */ }
    }
  });
  document.getElementById("ask-form").addEventListener("submit", (e) => { e.preventDefault(); const i = document.getElementById("ask-in"); const v = i.value; i.value = ""; send(v); });
  // The helper speaks first, with a few ready-made questions to tap.
  bubble("bot", `<span class="ask-who">${icon("bot")} Concierge</span><p>Hi${first ? ` ${esc(first)}` : ""}! Ask me anything: what's on at church, a Bible verse explained, a prayer for your week, help with homework or a tricky question. Tap one or just ask.</p>
    <div class="ask-sugg">${["What's happening this week?", "Explain John 3:16 simply", "Pray with me for exams", "When is the youth service?"].map((s) => `<button data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>`);
  const q = new URLSearchParams(location.search).get("q");
  if (q) send(q);
}

whenSignedIn(() => start());
start().catch((e) => { root.innerHTML = `<p class="muted-text">We couldn't open Ask SCC right now. ${esc(e.message || "")}</p>`; });
