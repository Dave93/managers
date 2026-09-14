import fs from "node:fs";
import { randomUUID } from "node:crypto";

export const MAX_FILES_PER_PHASE = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

// Generic UUID pattern (accepts all versions)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extForMime(mime: string): string | null {
  // Protect against type coercion
  if (typeof mime !== "string") return null;
  return MIME_EXT[mime] ?? null;
}

export function uploadsBase(): string {
  return process.env.TICKETS_UPLOADS_DIR ?? "/home/davr/managers/uploads/tickets";
}

export function attachmentPath(ticketId: string, ext: string): string {
  // Validate ticketId is a UUID to prevent path traversal attacks
  if (typeof ticketId !== "string" || !UUID_PATTERN.test(ticketId)) {
    throw new Error("attachmentPath: invalid ticket id");
  }
  return `${uploadsBase()}/${ticketId}/${randomUUID()}.${ext}`;
}

export function checkUpload(input: { mime: string; size: number; existingCount: number }):
  | { ok: true }
  | { ok: false; error: string } {
  // Protect against type coercion: validate that size and existingCount are finite numbers
  if (typeof input.size !== "number" || !Number.isFinite(input.size)) {
    return { ok: false, error: "некорректный размер файла" };
  }
  if (typeof input.existingCount !== "number" || !Number.isFinite(input.existingCount)) {
    return { ok: false, error: `больше ${MAX_FILES_PER_PHASE} фото на этап нельзя` };
  }
  
  if (!extForMime(input.mime)) return { ok: false, error: "только JPEG и PNG" };
  if (input.size <= 0) return { ok: false, error: "пустой файл" };
  if (input.size > MAX_FILE_BYTES) return { ok: false, error: "файл больше 10 МБ" };
  if (input.existingCount < 0) return { ok: false, error: `больше ${MAX_FILES_PER_PHASE} фото на этап нельзя` };
  if (input.existingCount >= MAX_FILES_PER_PHASE) {
    return { ok: false, error: `больше ${MAX_FILES_PER_PHASE} фото на этап нельзя` };
  }
  return { ok: true };
}

// Файл ложится на диск раньше строки в базе, поэтому вызывающий обязан удалить
// его, если вставка упала — иначе на диске копятся сироты, на которые ничто
// не ссылается. Тот же порядок и та же обязанность, что в credit_admin.
export async function saveAttachment(
  file: File,
  ticketId: string
): Promise<{ ok: true; file_path: string; mime: string; size_bytes: number } | { ok: false; error: string }> {
  const ext = extForMime(file.type);
  if (!ext) return { ok: false, error: "только JPEG и PNG" };
  
  // Validate ticketId is a UUID
  if (typeof ticketId !== "string" || !UUID_PATTERN.test(ticketId)) {
    return { ok: false, error: "invalid ticket id" };
  }
  
  const dir = `${uploadsBase()}/${ticketId}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.chmodSync(dir, 0o750);
  const file_path = attachmentPath(ticketId, ext);
  await Bun.write(file_path, file);
  return { ok: true, file_path, mime: file.type, size_bytes: file.size };
}
