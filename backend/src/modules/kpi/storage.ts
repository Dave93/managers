// Фото нарушений на диске, по образцу tickets/storage.ts.
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uploadsBase(): string {
  return process.env.KPI_UPLOADS_DIR ?? "/home/davr/managers/uploads/kpi";
}

// Код ошибки или null. index — порядковый номер файла в запросе (с нуля).
export function checkPhoto(f: { type: string; size: number }, index: number): string | null {
  if (index >= MAX_PHOTOS) return "too_many_photos";
  if (typeof f.type !== "string" || !Object.prototype.hasOwnProperty.call(MIME_EXT, f.type)) return "bad_photo_type";
  if (typeof f.size !== "number" || !Number.isFinite(f.size) || f.size <= 0) return "bad_photo_type";
  if (f.size > MAX_PHOTO_BYTES) return "photo_too_large";
  return null;
}

// Файл ложится на диск раньше строк в базе, поэтому вызывающий обязан удалить его,
// если вставка упала. onPath получает путь синхронно ДО записи: так недописанный
// файл тоже попадает в список на удаление.
export async function savePhoto(
  file: File,
  violationId: string,
  onPath?: (p: string) => void
): Promise<{ file_path: string; mime: string; size_bytes: number }> {
  if (typeof violationId !== "string" || !UUID_RE.test(violationId)) throw new Error("savePhoto: invalid violation id");
  if (!Object.prototype.hasOwnProperty.call(MIME_EXT, file.type)) throw new Error("savePhoto: bad mime");
  const dir = `${uploadsBase()}/${violationId}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.chmodSync(dir, 0o750);
  const file_path = `${dir}/${randomUUID()}.${MIME_EXT[file.type]}`;
  onPath?.(file_path);
  await Bun.write(file_path, file);
  return { file_path, mime: file.type, size_bytes: file.size };
}
