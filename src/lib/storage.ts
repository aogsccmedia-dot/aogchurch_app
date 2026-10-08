import type { Env } from "../env.ts";
import { HttpError } from "./http.ts";

/**
 * File storage abstraction.
 *
 * Today the account has R2 disabled, so uploads go to Workers KV (25 MB/value limit).
 * To move to R2: enable R2 in the dashboard, uncomment the r2_buckets block in
 * wrangler.jsonc and set STORAGE_DRIVER="r2". Old files keep working because each
 * attachment row records the driver it was written with.
 */
export type Driver = "kv" | "r2";

export interface StoredObject {
  body: ReadableStream | ArrayBuffer;
  contentType: string;
}

export function activeDriver(env: Env): Driver {
  if (env.STORAGE_DRIVER === "r2" && env.FILES_R2) return "r2";
  if (env.FILES_KV) return "kv";
  if (env.FILES_R2) return "r2";
  throw new HttpError(503, "File storage is not configured.");
}

export async function putFile(env: Env, driver: Driver, key: string, data: ArrayBuffer, contentType: string): Promise<void> {
  if (driver === "r2") {
    await env.FILES_R2!.put(key, data, { httpMetadata: { contentType } });
  } else {
    await env.FILES_KV!.put(key, data, { metadata: { contentType } });
  }
}

export async function getFile(env: Env, driver: string, key: string): Promise<StoredObject | null> {
  if (driver === "r2") {
    if (!env.FILES_R2) return null;
    const obj = await env.FILES_R2.get(key);
    if (!obj) return null;
    return { body: obj.body, contentType: obj.httpMetadata?.contentType || "application/octet-stream" };
  }
  if (!env.FILES_KV) return null;
  const res = await env.FILES_KV.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  if (!res.value) return null;
  return { body: res.value, contentType: res.metadata?.contentType || "application/octet-stream" };
}

export async function deleteFile(env: Env, driver: string, key: string): Promise<void> {
  if (driver === "r2") await env.FILES_R2?.delete(key);
  else await env.FILES_KV?.delete(key);
}

export const ALLOWED_TYPES: Record<string, string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  document: ["application/pdf", "image/jpeg", "image/png", "image/webp",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

/** Check magic bytes so a renamed .exe can't pose as a PDF. */
export function sniffType(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/heic";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "application/msword";
  return null;
}

export function safeFilename(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-100);
  return cleaned || "file";
}
