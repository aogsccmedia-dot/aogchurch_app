export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
  new Headers(extra).forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ ok: false, error: err.message, details: err.details ?? undefined }, err.status);
  }
  console.error("Unhandled error", err);
  return json({ ok: false, error: "Something went wrong on our side. Please try again." }, 500);
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "Request is too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request is too large.");
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "0.0.0.0";
}

/** Tiny path router: patterns like "/api/admin/members/:id" */
type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;
interface Route { method: string; parts: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }
  get(p: string, h: Handler) { return this.on("GET", p, h); }
  post(p: string, h: Handler) { return this.on("POST", p, h); }
  patch(p: string, h: Handler) { return this.on("PATCH", p, h); }
  put(p: string, h: Handler) { return this.on("PUT", p, h); }
  delete(p: string, h: Handler) { return this.on("DELETE", p, h); }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const segs = url.pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === req.method || (r.method === "GET" && req.method === "HEAD")) return r.handler(req, params);
    }
    if (pathMatched) throw new HttpError(405, "Method not allowed.");
    return null;
  }
}
