// The main admin's emailed code: live delivery status, a Resend button with a short countdown, and one-tap paste.
// Used by the sign-in dialog (auth.js) and the admin page's own sign-in.
const H = { "Content-Type": "application/json", "x-scc-admin": "1" };

/**
 * Wire up a code screen.
 *  statusEl: where "Sending… / Sent ✓ / Didn't go through" shows
 *  resendBtn: the Resend button (gets a countdown)
 *  pasteBtn: optional "Paste code" button
 *  input: the code input (pasting fills it and submits)
 *  onChallenge(id): called when a resend gives a new code
 */
export function codeScreen({ challenge, sentTo, statusEl, resendBtn, pasteBtn, input, onChallenge, resendIn = 30 }) {
  let ch = challenge, timer = null, poll = null, stopped = false;
  const say = (html, kind = "") => { statusEl.className = `code-status ${kind}`; statusEl.innerHTML = html; };

  function countdown(sec) {
    clearInterval(timer);
    let left = Math.max(0, Math.round(sec));
    const tick = () => {
      if (stopped) return clearInterval(timer);
      resendBtn.disabled = left > 0;
      resendBtn.textContent = left > 0 ? `Resend in ${left}s` : "Resend code";
      if (left-- <= 0) clearInterval(timer);
    };
    tick(); timer = setInterval(tick, 1000);
  }

  function watch() {
    clearInterval(poll);
    let n = 0;
    say(`<i class="spinner" aria-hidden="true"></i> Sending your code to <b>${sentTo}</b>…`);
    const check = async () => {
      if (stopped) return clearInterval(poll);
      n++;
      const r = await fetch(`/api/auth/admin/code-status?c=${encodeURIComponent(ch)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const d = r?.delivery;
      if (d === "sent") { clearInterval(poll); say(`✓ Code sent to <b>${sentTo}</b>. Not there? Check Spam or Promotions.`, "ok"); }
      else if (d === "failed") { clearInterval(poll); say(`The email didn't go through. Tap <b>Resend code</b> to try again.`, "err"); countdown(0); }
      else if (n > 12) { clearInterval(poll); say(`✓ Code on its way to <b>${sentTo}</b>. If it hasn't arrived in a minute, tap Resend.`, "ok"); }
    };
    poll = setInterval(check, 1200); check();
  }

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true; resendBtn.textContent = "Sending…";
    try {
      const r = await fetch("/api/auth/admin/request-code", { method: "POST", headers: H, credentials: "same-origin", body: "{}" }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Couldn't send a new code.");
      if (r.challenge !== ch) { ch = r.challenge; onChallenge?.(ch); }
      countdown(r.resend_in ?? resendIn);
      if (r.reused) say(`✓ We just sent a code to <b>${sentTo}</b>. Any recent code works.`, "ok"); else watch();
    } catch (e) { say(e.message, "err"); countdown(5); }
  });

  if (pasteBtn) {
    if (!navigator.clipboard?.readText) pasteBtn.hidden = true;
    pasteBtn.addEventListener("click", async () => {
      try {
        const t = (await navigator.clipboard.readText()).match(/\d{6}/)?.[0];
        if (!t) { say("Copy the 6-digit code from the email first, then tap Paste.", "err"); return; }
        input.value = t; input.dispatchEvent(new Event("input", { bubbles: true }));
        input.form?.requestSubmit();
      } catch { pasteBtn.hidden = true; input.focus(); }
    });
  }

  countdown(resendIn); watch();
  return { get challenge() { return ch; }, stop() { stopped = true; clearInterval(timer); clearInterval(poll); } };
}
