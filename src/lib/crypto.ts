const enc = new TextEncoder();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

export function randomToken(bytes = 32): string {
  const u8 = new Uint8Array(bytes);
  crypto.getRandomValues(u8);
  return b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Human friendly reference, e.g. SCCY-26-7KQ4M */
export function refCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const u8 = new Uint8Array(5);
  crypto.getRandomValues(u8);
  const tail = [...u8].map((b) => alphabet[b % alphabet.length]).join("");
  return `SCCY-${String(new Date().getUTCFullYear()).slice(2)}-${tail}`;
}

// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: BufferSource, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, saltB64, hashB64] = stored.split("$");
  if (algo !== "pbkdf2-sha256" || !iter || !saltB64 || !hashB64) return false;
  const computed = new Uint8Array(await pbkdf2(password, fromB64(saltB64) as BufferSource, Number(iter)));
  const expected = fromB64(hashB64);
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed[i] ^ expected[i];
  return diff === 0;
}
