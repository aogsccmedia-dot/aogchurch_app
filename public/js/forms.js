// Renders a Tally-style form schema (built in the admin) into HTML inputs.
import { esc } from "./site.js";

export const FIELD_TYPES = {
  short_text: "Short answer", long_text: "Paragraph", email: "Email", phone: "Phone", number: "Number", date: "Date",
  select: "Dropdown", radio: "Multiple choice", checkbox: "Checkboxes", yes_no: "Yes / No", file: "File upload", statement: "Text block",
};

export function renderField(f) {
  const name = `f_${f.id}`;
  const req = f.required ? " required" : "";
  const label = `<label class="${f.required ? "req" : ""}" for="${name}">${esc(f.label)}</label>`;
  const help = f.help ? `<span class="hint">${esc(f.help)}</span>` : "";
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
  const wrap = (inner, lab = label) => `<div class="field" data-field="${name}">${lab}${help}${inner}<span class="error"></span></div>`;
  const span = `<span class="label ${f.required ? "req" : ""}">${esc(f.label)}</span>`;
  switch (f.type) {
    case "statement": return `<p class="statement">${esc(f.label)}${f.help ? `<br><span class="hint">${esc(f.help)}</span>` : ""}</p>`;
    case "long_text": return wrap(`<textarea class="input" id="${name}" name="${name}"${req}${ph} maxlength="5000"></textarea>`);
    case "email": return wrap(`<input class="input" type="email" id="${name}" name="${name}"${req}${ph}>`);
    case "phone": return wrap(`<input class="input" type="tel" id="${name}" name="${name}"${req}${ph}>`);
    case "number": return wrap(`<input class="input" type="number" inputmode="decimal" id="${name}" name="${name}"${req}${ph}>`);
    case "date": return wrap(`<input class="input" type="date" id="${name}" name="${name}"${req}>`);
    case "select": return wrap(`<select class="input" id="${name}" name="${name}"${req}><option value="">Choose…</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`);
    case "radio": return wrap(`<div class="chips">${f.options.map((o) => `<label class="chip"><input type="radio" name="${name}" value="${esc(o)}"${req}><span>${esc(o)}</span></label>`).join("")}</div>`, span);
    case "checkbox": return wrap(`<div class="chips">${f.options.map((o) => `<label class="chip"><input type="checkbox" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div>`, span);
    case "yes_no": return wrap(`<div class="chips">${["Yes", "No"].map((o) => `<label class="chip"><input type="radio" name="${name}" value="${o}"${req}><span>${o}</span></label>`).join("")}</div>`, span);
    case "file": return wrap(`<input class="input" type="file" id="${name}" name="${name}" accept="application/pdf,image/*,.doc,.docx"${req}>`);
    default: return wrap(`<input class="input" type="text" id="${name}" name="${name}"${req}${ph} maxlength="500">`);
  }
}
