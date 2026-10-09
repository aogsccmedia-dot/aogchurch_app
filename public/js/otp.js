// 6-digit verification code field: six clear boxes over one real input (so paste, phone
// "from email/messages" autofill and screen readers all work). Calls onComplete with the code.
export function otpField(input, onComplete) {
  if (input.closest(".otp")) return input.closest(".otp");
  input.setAttribute("maxlength", "6");
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("autocomplete", "one-time-code");
  input.setAttribute("pattern", "[0-9]{6}");
  input.setAttribute("aria-label", "6-digit verification code");
  input.removeAttribute("placeholder");
  input.classList.remove("code-input");
  const wrap = document.createElement("div");
  wrap.className = "otp";
  input.before(wrap);
  wrap.innerHTML = Array.from({ length: 6 }, () => `<span class="otp-box" aria-hidden="true"></span>`).join("");
  wrap.append(input);
  const boxes = [...wrap.querySelectorAll(".otp-box")];
  let fired = "";
  const render = () => {
    const v = input.value.replace(/\D/g, "").slice(0, 6);
    if (input.value !== v) input.value = v;
    boxes.forEach((b, i) => { b.textContent = v[i] || ""; b.classList.toggle("filled", !!v[i]); b.classList.toggle("active", document.activeElement === input && i === Math.min(v.length, 5)); });
    if (v.length === 6 && fired !== v) { fired = v; onComplete?.(v); }
    if (v.length < 6) fired = "";
  };
  ["input", "focus", "blur", "keyup"].forEach((ev) => input.addEventListener(ev, render));
  wrap.addEventListener("click", () => input.focus());
  render();
  return wrap;
}

/** Small "working on it" overlay (spinner + message). Returns a function that removes it. */
export function busy(message = "One moment…") {
  const el = document.createElement("div");
  el.className = "busy-overlay";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="busy-card"><span class="spinner" aria-hidden="true"></span><p>${message.replace(/[<>&]/g, "")}</p></div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  return () => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); };
}
