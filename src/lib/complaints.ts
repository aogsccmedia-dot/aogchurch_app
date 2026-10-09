/** Complaints: approved members raise them from their profile; the admin responds from the dashboard. */
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError } from "./http.ts";
import { uuid } from "./crypto.ts";
import { Validator } from "./validate.ts";
import { sendMail } from "./email.ts";
import { COMPLAINT_CATEGORIES } from "../constants.ts";
import * as T from "../emails/templates.ts";

export interface ComplaintMember { id: string; first_name: string; last_name: string; preferred_name: string | null; email: string | null; status: string }

/** Only members the church has approved (status "member") can raise complaints. */
export async function approvedMember(env: Env, userId: string, email: string) {
  const m = await env.DB.prepare("SELECT id, first_name, last_name, preferred_name, email, status FROM members WHERE (user_id = ? OR email = ?) AND status != 'revoked' ORDER BY created_at DESC LIMIT 1")
    .bind(userId, email).first<ComplaintMember>();
  return m && m.status === "member" ? m : null;
}

const complaintRef = () => "CMP-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

export async function createComplaint(env: Env, m: ComplaintMember, userId: string, body: Record<string, unknown>) {
  const v = new Validator(body);
  const category = v.oneOf("category", COMPLAINT_CATEGORIES, { required: true, label: "Category" });
  const subject = v.text("subject", { required: true, max: 140, min: 4, label: "Subject" });
  const details = v.text("details", { required: true, max: 5000, min: 20, label: "Details" });
  const outcome = v.text("desired_outcome", { max: 1000 });
  const confidential = v.bool("confidential");
  v.assert();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM complaints WHERE member_id = ? AND created_at > ?")
    .bind(m.id, new Date(Date.now() - 86400_000).toISOString()).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) throw new HttpError(429, "You've raised several complaints today. Please give us a little time to respond.");
  const id = uuid(), ref = complaintRef();
  await env.DB.prepare(`INSERT INTO complaints (id, ref_code, member_id, user_id, category, subject, details, desired_outcome, confidential) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, ref, m.id, userId, category, subject, details, outcome, confidential ? 1 : 0).run();
  const site = siteUrl(env);
  const name = m.preferred_name || m.first_name;
  if (m.email) await sendMail(env, { to: m.email, toName: `${m.first_name} ${m.last_name}`, ...T.complaintReceived({ site }, { name, ref, subject: subject! }), template: "complaint_received" });
  await sendMail(env, { to: adminEmail(env), ...T.adminNewComplaint({ site }, { name: `${m.first_name} ${m.last_name}`, ref, category: category!, subject: subject!, confidential }), template: "admin_new_complaint" });
  return { id, ref };
}
