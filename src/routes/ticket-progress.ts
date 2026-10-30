// Ticket money against the target: only the main admin, church admins and verified pastors can see it,
// and only the main admin changes a target.
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { getSession } from "../lib/auth.ts";
import { processTicketRecon, seesTicketMoney, ticketProgress } from "../lib/ticket-progress.ts";

export function ticketProgressRoutes(router: Router, env: Env): void {
  router.get("/api/leaders/ticket-progress", async (req) => {
    const s = await getSession(env, req);
    if (!seesTicketMoney(s)) throw new HttpError(403, "Only church admins and pastors can see this.");
    return json({ ok: true, events: await ticketProgress(env), can_set: s!.role === "super" }, 200, { "Cache-Control": "private, no-store" });
  });
  router.put("/api/leaders/ticket-progress/:id", async (req, { id }) => {
    const s = await getSession(env, req);
    if (s?.role !== "super") throw new HttpError(403, "Only the main admin sets ticket targets.");
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const { target } = await readJson<{ target?: number | string | null }>(req);
    const v = target === null || target === "" ? null : Math.round(Number(target));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100_000_000)) throw new HttpError(422, "Enter the target in Rands, e.g. 80000.");
    const r = await env.DB.prepare("UPDATE events SET ticket_target = ? WHERE id = ?").bind(v || null, id).run();
    if (!r.meta.changes) throw new HttpError(404, "Event not found.");
    return json({ ok: true });
  });
  // The main admin can send this week's report to themselves only, to see it.
  router.post("/api/leaders/ticket-progress/test", async (req) => {
    const s = await getSession(env, req);
    if (s?.role !== "super") throw new HttpError(403, "Only the main admin can do this.");
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    return json({ ok: true, sent: await processTicketRecon(env, new Date(), { test: true }) });
  });
}
