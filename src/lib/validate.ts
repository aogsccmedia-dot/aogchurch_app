import { HttpError } from "./http.ts";

/**
 * Minimal, dependency-free validation. Each field spec turns raw input
 * (string | undefined) into a clean value or records an error message.
 */
export type Raw = Record<string, unknown>;

export class Validator {
  errors: Record<string, string> = {};
  private src: Raw;
  constructor(src: Raw) { this.src = src; }

  private raw(key: string): string {
    const v = this.src[key];
    if (v === undefined || v === null) return "";
    if (Array.isArray(v)) return String(v[0] ?? "");
    return String(v).trim();
  }

  text(key: string, opts: { required?: boolean; max?: number; min?: number; label?: string } = {}): string | null {
    const v = this.raw(key);
    const label = opts.label || "This field";
    if (!v) { if (opts.required) this.errors[key] = `${label} is required.`; return null; }
    if (opts.min && v.length < opts.min) this.errors[key] = `${label} is too short.`;
    if (v.length > (opts.max ?? 500)) this.errors[key] = `${label} is too long.`;
    return v;
  }

  email(key: string, required = true): string | null {
    const v = this.text(key, { required, max: 254, label: "Email" });
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) this.errors[key] = "Please enter a valid email address.";
    return v ? v.toLowerCase() : null;
  }

  phone(key: string, required = true, label = "Phone number"): string | null {
    const v = this.text(key, { required, max: 30, label });
    if (!v) return null;
    const digits = v.replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length < 9) { this.errors[key] = `Please enter a valid ${label.toLowerCase()}.`; return v; }
    // Normalise SA numbers: 0821234567 -> +27821234567
    if (/^0\d{9}$/.test(digits)) return "+27" + digits.slice(1);
    return digits;
  }

  date(key: string, opts: { required?: boolean; label?: string } = {}): string | null {
    const v = this.text(key, { required: opts.required, max: 10, label: opts.label || "Date" });
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) this.errors[key] = "Please enter a valid date.";
    return v;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], opts: { required?: boolean; label?: string } = {}): T | null {
    const v = this.text(key, { required: opts.required, label: opts.label, max: 60 });
    if (!v) return null;
    if (!allowed.includes(v as T)) { this.errors[key] = "Please choose a valid option."; return null; }
    return v as T;
  }

  bool(key: string): boolean {
    const v = this.raw(key).toLowerCase();
    return v === "1" || v === "true" || v === "on" || v === "yes";
  }

  list<T extends string>(key: string, allowed: readonly T[]): T[] {
    const v = this.src[key];
    const arr = Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : [];
    return [...new Set(arr.map((x) => String(x).trim()).filter((x) => allowed.includes(x as T)))] as T[];
  }

  assert(): void {
    if (Object.keys(this.errors).length) throw new HttpError(422, "Please check the highlighted fields.", this.errors);
  }
}

/** Turn FormData into a Raw object (multi-value keys become arrays). Files are skipped. */
export function formToRaw(fd: FormData): Raw {
  const out: Raw = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k in out) {
      const cur = out[k];
      out[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else out[k] = v;
  }
  return out;
}

export function ageOn(dobIso: string, now = new Date()): number {
  const d = new Date(dobIso + "T00:00:00Z");
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
