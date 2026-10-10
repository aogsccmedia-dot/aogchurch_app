/**
 * Church programme: public items (SCC calendar), members-only items (Germiston Sub-Region planner),
 * leaders-only items (board meetings), plus admin CRUD. Weekly services come from Admin → Weekly services.
 */
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson } from "../lib/http.ts";
import { getSession, requireAdmin } from "../lib/auth.ts";
import { Validator } from "../lib/validate.ts";
import { programmeWhen, type ProgrammeRow } from "../lib/programme.ts";
import { publicWeekly } from "./insights.ts";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const AUDIENCES = ["public", "members", "leaders"] as const;

export function programmeRoutes(router: Router, env: Env): void {
  router.get("/api/programme", async (req) => {
    const url = new URL(req.url);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from")! : today();
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") || 120)));
    const s = await getSession(env, req);
    let member = false;
    if (s) {
      if (s.kind === "admin") member = true;
      else member = !!(await env.DB.prepare("SELECT 1 FROM members WHERE (user_id = ? OR email = ?) AND status != 'revoked'").bind(s.user.id, s.user.email).first());
    }
    const audiences = member ? ["public", "members"] : ["public"];
    const { results } = await env.DB.prepare(
      `SELECT id, source, audience, start_date, end_date, time_label, title, department, venue, notes FROM church_programme
        WHERE audience IN (${audiences.map(() => "?").join(",")}) AND COALESCE(end_date, start_date) >= ? ORDER BY start_date, title LIMIT ?`)
      .bind(...audiences, from, limit).all<ProgrammeRow>();
    return json({ ok: true, member, weekly: await publicWeekly(env), items: results.map((p) => ({ ...p, when: programmeWhen(p) })) });
  });

  // ---------- admin ----------
  const admin = async (req: Request) => {
    const s = await requireAdmin(env, req);
    if (req.method !== "GET" && req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    return s;
  };
  const read = (body: Record<string, unknown>) => {
    const v = new Validator(body);
    const start = v.text("start_date", { required: true, max: 10, label: "Date" });
    const end = v.text("end_date", { max: 10 });
    if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) v.errors.start_date = "Use a valid date.";
    if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) v.errors.end_date = "Use a valid date.";
    const out = {
      start_date: start, end_date: end && end !== start ? end : null, time_label: v.text("time_label", { max: 40 }),
      title: v.text("title", { required: true, max: 140, label: "Title" }), department: v.text("department", { max: 60 }),
      venue: v.text("venue", { max: 140 }), notes: v.text("notes", { max: 500 }),
      audience: v.oneOf("audience", AUDIENCES, { required: true, label: "Who can see it" }),
    };
    v.assert();
    return out;
  };
  router.get("/api/admin/programme", async (req) => {
    await admin(req);
    const from = new URL(req.url).searchParams.get("from") || `${new Date().getFullYear()}-01-01`;
    const { results } = await env.DB.prepare("SELECT * FROM church_programme WHERE COALESCE(end_date, start_date) >= ? ORDER BY start_date, title LIMIT 500").bind(from).all<ProgrammeRow>();
    return json({ ok: true, items: results.map((p) => ({ ...p, when: programmeWhen(p) })) });
  });
  router.post("/api/admin/programme", async (req) => {
    await admin(req);
    const p = read(await readJson(req));
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO church_programme (id, source, audience, start_date, end_date, time_label, title, department, venue, notes) VALUES (?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, p.audience, p.start_date, p.end_date, p.time_label, p.title, p.department, p.venue, p.notes).run();
    return json({ ok: true, id }, 201);
  });
  router.put("/api/admin/programme/:id", async (req, { id }) => {
    await admin(req);
    const p = read(await readJson(req));
    const r = await env.DB.prepare("UPDATE church_programme SET audience=?, start_date=?, end_date=?, time_label=?, title=?, department=?, venue=?, notes=? WHERE id = ?")
      .bind(p.audience, p.start_date, p.end_date, p.time_label, p.title, p.department, p.venue, p.notes, id).run();
    if (!r.meta.changes) throw new HttpError(404, "Not found.");
    return json({ ok: true });
  });
  router.delete("/api/admin/programme/:id", async (req, { id }) => {
    await admin(req);
    await env.DB.prepare("DELETE FROM church_programme WHERE id = ?").bind(id).run();
    return json({ ok: true });
  });
}
