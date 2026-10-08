import type { Env } from "../env.ts";
import { HttpError } from "./http.ts";
import { sha256Hex } from "./crypto.ts";

/**
 * Fixed-window rate limiter stored in D1. Cheap and good enough for form spam.
 * For very high traffic, swap for the Workers Rate Limiting binding.
 */
export async function rateLimit(env: Env, scope: string, ip: string, limit: number, windowSec: number): Promise<void> {
  const bucket = `${scope}:${(await sha256Hex(ip)).slice(0, 24)}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
       window_start = ?2
     RETURNING count`,
  ).bind(bucket, windowStart).first<{ count: number }>();
  if (row && row.count > limit) {
    throw new HttpError(429, "You're sending requests too quickly. Please wait a few minutes and try again.");
  }
}

export async function ipHash(ip: string): Promise<string> {
  return (await sha256Hex("aogscc-youth:" + ip)).slice(0, 32);
}
