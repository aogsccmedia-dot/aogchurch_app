import type { Env } from "../env.ts";
import { HttpError } from "./http.ts";
import { uuid } from "./crypto.ts";
import { ALLOWED_TYPES, activeDriver, deleteFile, putFile, safeFilename, sniffType, type Driver } from "./storage.ts";

export interface PendingFile { kind: "photo" | "document" | "image" | "answer"; field?: string; name: string; data: ArrayBuffer; type: string }

const KIND_TYPES: Record<PendingFile["kind"], string[]> = {
  photo: ALLOWED_TYPES.photo,
  image: ALLOWED_TYPES.photo,
  document: ALLOWED_TYPES.document,
  answer: ALLOWED_TYPES.document,
};

/** Read, size-check and magic-byte-check an uploaded file. */
export async function readUpload(env: Env, file: File, kind: PendingFile["kind"], field?: string): Promise<PendingFile> {
  const maxBytes = Number(env.MAX_UPLOAD_MB || "10") * 1024 * 1024;
  const errKey = field ? (field.startsWith("f_") ? field : `f_${field}`) : kind;
  if (file.size > maxBytes) throw new HttpError(413, `"${file.name}" is larger than ${env.MAX_UPLOAD_MB || 10} MB.`, { [errKey]: "File too large." });
  const data = await file.arrayBuffer();
  const type = sniffType(data);
  if (!type || !KIND_TYPES[kind].includes(type)) throw new HttpError(415, `"${file.name}" isn't a supported file type.`, { [errKey]: "Unsupported file type." });
  return { kind, field, name: file.name, data, type };
}

/**
 * Upload files to storage and return D1 statements that record them.
 * Call `rollback()` if the database write fails afterwards.
 */
export async function storeFiles(env: Env, ownerType: string, ownerId: string, files: PendingFile[]) {
  const driver: Driver = activeDriver(env);
  const uploaded: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  try {
    for (const f of files) {
      const id = uuid();
      const key = `${ownerType}/${ownerId}/${id}-${safeFilename(f.name)}`;
      await putFile(env, driver, key, f.data, f.type);
      uploaded.push(key);
      ids.push(id);
      stmts.push(env.DB.prepare(
        `INSERT INTO attachments (id, owner_type, owner_id, kind, filename, content_type, size_bytes, storage_driver, storage_key)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(id, ownerType, ownerId, f.field ? `answer:${f.field}` : f.kind, safeFilename(f.name), f.type, f.data.byteLength, driver, key));
    }
  } catch (e) {
    await Promise.allSettled(uploaded.map((k) => deleteFile(env, driver, k)));
    throw e;
  }
  return { stmts, ids, rollback: () => Promise.allSettled(uploaded.map((k) => deleteFile(env, driver, k))) };
}

export async function deleteOwnerFiles(env: Env, ownerType: string, ownerId: string) {
  const { results } = await env.DB.prepare("SELECT storage_driver, storage_key FROM attachments WHERE owner_type = ? AND owner_id = ?")
    .bind(ownerType, ownerId).all<{ storage_driver: string; storage_key: string }>();
  await Promise.allSettled(results.map((a) => deleteFile(env, a.storage_driver, a.storage_key)));
  return env.DB.prepare("DELETE FROM attachments WHERE owner_type = ? AND owner_id = ?").bind(ownerType, ownerId);
}
