import { HttpError } from "./http.ts";

/**
 * Tally-style form schema. Admins build a list of fields per event; the public
 * page renders them and the server validates every answer against the schema.
 */
export const FIELD_TYPES = [
  "short_text", "long_text", "email", "phone", "number", "date",
  "select", "radio", "checkbox", "yes_no", "file", "statement",
] as const;
export type FieldType = typeof FIELD_TYPES[number];

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  help?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

const OPTION_TYPES: FieldType[] = ["select", "radio", "checkbox"];

/** Clean and validate a schema coming from the admin builder. */
export function sanitizeSchema(input: unknown): Field[] {
  if (!Array.isArray(input)) throw new HttpError(422, "Form fields must be a list.");
  if (input.length > 40) throw new HttpError(422, "A form can have at most 40 fields.");
  const seen = new Set<string>();
  return input.map((raw, i) => {
    const f = raw as Record<string, unknown>;
    const type = String(f.type) as FieldType;
    if (!FIELD_TYPES.includes(type)) throw new HttpError(422, `Field ${i + 1} has an unknown type.`);
    let id = String(f.id || "").replace(/[^a-z0-9_]/gi, "").slice(0, 24) || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const label = String(f.label || "").trim().slice(0, 300);
    if (!label) throw new HttpError(422, `Field ${i + 1} needs a question/label.`);
    const field: Field = { id, type, label };
    if (f.help) field.help = String(f.help).slice(0, 500);
    if (f.placeholder) field.placeholder = String(f.placeholder).slice(0, 120);
    if (type !== "statement" && f.required) field.required = true;
    if (OPTION_TYPES.includes(type)) {
      const opts = (Array.isArray(f.options) ? f.options : []).map((o) => String(o).trim().slice(0, 120)).filter(Boolean);
      const uniq = [...new Set(opts)].slice(0, 30);
      if (uniq.length < 1) throw new HttpError(422, `"${label}" needs at least one option.`);
      field.options = uniq;
    }
    return field;
  });
}

export function parseSchema(json: string | null | undefined): Field[] {
  try { const v = JSON.parse(json || "[]"); return Array.isArray(v) ? v as Field[] : []; } catch { return []; }
}

export interface FileAnswer { field: string; file: File }

/** Validate submitted answers. Returns clean answers + files to store, or throws 422 with field errors. */
export function validateAnswers(schema: Field[], fd: FormData): { answers: Record<string, unknown>; files: FileAnswer[] } {
  const errors: Record<string, string> = {};
  const answers: Record<string, unknown> = {};
  const files: FileAnswer[] = [];
  for (const f of schema) {
    if (f.type === "statement") continue;
    const key = `f_${f.id}`;
    if (f.type === "file") {
      const list = fd.getAll(key).filter((x): x is File => typeof x !== "string" && x.size > 0).slice(0, 3);
      if (f.required && !list.length) errors[key] = "Please attach a file.";
      for (const file of list) files.push({ field: f.id, file });
      if (list.length) answers[f.id] = list.map((x) => x.name);
      continue;
    }
    if (f.type === "checkbox") {
      const vals = fd.getAll(key).map(String).filter((v) => f.options!.includes(v));
      if (f.required && !vals.length) errors[key] = "Please choose at least one.";
      if (vals.length) answers[f.id] = vals;
      continue;
    }
    const v = String(fd.get(key) ?? "").trim();
    if (!v) { if (f.required) errors[key] = "This one's required."; continue; }
    if (v.length > (f.type === "long_text" ? 5000 : 500)) { errors[key] = "That's a bit too long."; continue; }
    switch (f.type) {
      case "email": if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errors[key] = "Please enter a valid email."; break;
      case "phone": if (v.replace(/\D/g, "").length < 9) errors[key] = "Please enter a valid phone number."; break;
      case "number": if (isNaN(Number(v))) errors[key] = "Please enter a number."; break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[key] = "Please choose a date."; break;
      case "select": case "radio": if (!f.options!.includes(v)) errors[key] = "Please choose a valid option."; break;
      case "yes_no": if (v !== "Yes" && v !== "No") errors[key] = "Please choose yes or no."; break;
    }
    answers[f.id] = f.type === "number" ? Number(v) : v;
  }
  if (Object.keys(errors).length) throw new HttpError(422, "Please check the highlighted questions.", errors);
  return { answers, files };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "event";
}
