// Gentle three-step offboarding when a member revokes their membership:
// 1) "May we ask why?" (5 common reasons + Other)  2) confirm  3) a warm goodbye.
// Used on the profile (in a sheet) and on /membership (the check-in email link).
import { esc } from "./site.js";
import { icon } from "./icons.js";

export const REASONS = [
  ["moved", "I've moved to a different area"],
  ["other_church", "I've joined another church"],
  ["schedule", "My schedule doesn't allow me to attend right now"],
  ["season", "I'm taking a season away to rest and reflect"],
  ["connection", "I didn't feel connected or at home here"],
  ["other", "Other"],
];

/**
 * Render the flow into `host`.
 * opts.name     first name to greet
 * opts.submit   async ({ reason_code, reason }) => void  (throws on failure)
 * opts.onKeep   called when they choose to stay
 * opts.onClose  called from the final screen's close button (optional)
 */
export function revokeFlow(host, { name, submit, onKeep, onClose }) {
  const state = { code: "", detail: "" };
  const go = (html, focus) => {
    host.innerHTML = `<div class="ob">${html}</div>`;
    host.querySelector(".ob").animate?.([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
    (host.querySelector(focus || "h2") || host).focus?.({ preventScroll: false });
  };
  const steps = (n) => `<p class="ob-step"><span class="${n >= 1 ? "on" : ""}"></span><span class="${n >= 2 ? "on" : ""}"></span><span class="${n >= 3 ? "on" : ""}"></span></p>`;

  function why() {
    go(`${steps(1)}
      <h2 tabindex="-1">Before you go, may we ask why?</h2>
      <p class="ob-lede">It helps our leaders care for the church family better. Choose the one that fits best.</p>
      <div class="ob-reasons" role="radiogroup" aria-label="Reason for leaving">
        ${REASONS.map(([code, label]) => `<label class="ob-reason"><input type="radio" name="ob-reason" value="${code}" ${state.code === code ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}
      </div>
      <div class="ob-other" ${state.code === "other" ? "" : "hidden"}>
        <label for="ob-detail">Please tell us a little more</label>
        <textarea class="input" id="ob-detail" maxlength="500" rows="3" placeholder="Share as much or as little as you like">${esc(state.detail)}</textarea>
      </div>
      <p class="ob-err" role="alert" hidden></p>
      <div class="ob-actions">
        <button class="btn" type="button" data-ob-keep>I'd like to stay</button>
        <button class="btn btn-gold" type="button" data-ob-next disabled>Continue ${icon("arrowRight", "arr")}</button>
      </div>`);
    const next = host.querySelector("[data-ob-next]"), other = host.querySelector(".ob-other"), detail = host.querySelector("#ob-detail");
    const sync = () => { next.disabled = !state.code || (state.code === "other" && !state.detail.trim()); };
    host.querySelectorAll("input[name=ob-reason]").forEach((r) => r.addEventListener("change", () => {
      state.code = r.value; other.hidden = state.code !== "other";
      if (state.code === "other") detail.focus();
      sync();
    }));
    detail.addEventListener("input", () => { state.detail = detail.value; sync(); });
    sync();
    host.querySelector("[data-ob-keep]").addEventListener("click", () => onKeep?.());
    next.addEventListener("click", confirmStep);
  }

  function confirmStep() {
    const label = REASONS.find(([c]) => c === state.code)?.[1] || "";
    const said = state.code === "other" ? state.detail.trim() : label;
    go(`${steps(2)}
      <h2 tabindex="-1">Are you sure, ${esc(name)}?</h2>
      <p class="ob-lede">Here's what happens when you revoke your membership:</p>
      <ul class="ob-list">
        <li>You'll be removed from the member list and the 4-monthly check-ins stop.</li>
        <li>Any member-only access (like team roles) is removed.</li>
        <li>Your weekly letter and event tickets stay as they are.</li>
        <li>You can rejoin anytime. Our doors are always open.</li>
      </ul>
      <blockquote class="ob-said"><small>Your reason</small>${esc(said)}</blockquote>
      <p class="ob-err" role="alert" hidden></p>
      <div class="ob-actions">
        <button class="btn" type="button" data-ob-back>${icon("arrowLeft")} Back</button>
        <button class="btn btn-danger" type="button" data-ob-go>Yes, revoke my membership</button>
      </div>
      <button class="ob-stay" type="button" data-ob-keep>Actually, I'd like to stay</button>`);
    host.querySelector("[data-ob-back]").addEventListener("click", why);
    host.querySelector("[data-ob-keep]").addEventListener("click", () => onKeep?.());
    const btn = host.querySelector("[data-ob-go]"), err = host.querySelector(".ob-err");
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.innerHTML = `<span class="ob-spin" aria-hidden="true"></span> Revoking…`; err.hidden = true;
      try { await submit({ reason_code: state.code, reason: state.code === "other" ? state.detail.trim() : "" }); done(); }
      catch (e) { err.textContent = e.message || "Something went wrong. Please try again."; err.hidden = false; btn.disabled = false; btn.textContent = "Yes, revoke my membership"; }
    });
  }

  function done() {
    go(`${steps(3)}
      <div class="ob-heart" aria-hidden="true">${icon("handHeart")}</div>
      <h2 tabindex="-1">We're sorry to see you go, ${esc(name)}</h2>
      <p class="ob-lede">Your membership has been revoked. Thank you for every Sunday, every prayer and every moment you shared with us.</p>
      <p class="ob-lede">We'll keep you in our prayers. We've sent you an email, and if there's any way we can support you, simply reply to it or send us a prayer request.</p>
      <p class="ob-verse">“The Lord bless you and keep you.” <span>Numbers 6:24</span></p>
      <div class="ob-actions">
        <a class="btn" href="/prayer">Send a prayer request</a>
        <a class="btn btn-gold" href="/join">Rejoin anytime</a>
      </div>
      ${onClose ? `<button class="ob-stay" type="button" data-ob-close>Close</button>` : ""}`);
    host.querySelector("[data-ob-close]")?.addEventListener("click", () => onClose());
  }

  why();
}
