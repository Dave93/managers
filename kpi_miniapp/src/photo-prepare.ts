// Подготовка фото нарушения перед отправкой (без DOM, чтобы проверял тест): порт preparePhoto
// из admin/lib/tickets-create.ts. Сервер берёт JPEG и PNG до max_photo_bytes; кадр с длинной
// стороной больше 1600 сжимается в JPEG 0,85. Отказ приходит значением, не исключением.
export const MAX_PHOTO_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

export interface PhotoIO<I> {
  // Бросает, если файл не картинка, которую браузер способен разобрать.
  decode(file: File): Promise<{ image: I; width: number; height: number }>;
  // null: canvas.toBlob не справился (бывает на очень больших кадрах в Safari).
  encode(image: I, width: number, height: number): Promise<Blob | null>;
  release(image: I): void;
}

export type PhotoOutcome = { ok: true; file: File; recompressed: boolean } | { ok: false; reason: "empty" | "decode" | "no_size" | "prepare" | "too_big" };

const fail = (reason: Exclude<PhotoOutcome, { ok: true }>["reason"]): PhotoOutcome => ({ ok: false, reason });

/** Длинная сторона не больше max, пропорции сохраняются. */
export function fitWithin(width: number, height: number, max: number = MAX_PHOTO_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Имя с расширением .jpg: «IMG_1.png» → «IMG_1.jpg». */
function jpegName(name: string): string {
  const n = name.trim();
  if (!n) return "photo.jpg";
  if (/\.jpe?g$/i.test(n)) return n;
  return /\.[^./\\]+$/.test(n) ? n.replace(/\.[^./\\]+$/, ".jpg") : `${n}.jpg`;
}

const accepted = (type: string): boolean => type === "image/jpeg" || type === "image/png";

export async function preparePhoto<I>(file: File, io: PhotoIO<I>, maxBytes: number): Promise<PhotoOutcome> {
  if (file.size <= 0) return fail("empty");
  let decoded: { image: I; width: number; height: number };
  try {
    decoded = await io.decode(file);
  } catch {
    return fail("decode");
  }
  const { image, width, height } = decoded;
  try {
    if (!(width > 0 && height > 0)) return fail("no_size");
    const originalFits = accepted(file.type) && file.size <= maxBytes;
    if (originalFits && Math.max(width, height) <= MAX_PHOTO_SIDE) return { ok: true, file, recompressed: false };

    const to = fitWithin(width, height);
    let blob: Blob | null = null;
    try {
      blob = await io.encode(image, to.width, to.height);
    } catch {
      blob = null;
    }
    // Safari подменяет неподдержанный формат PNG-ом молча: проверяем тип.
    if (!blob || blob.size <= 0 || blob.type !== "image/jpeg") return originalFits ? { ok: true, file, recompressed: false } : fail("prepare");
    if (originalFits && blob.size >= file.size) return { ok: true, file, recompressed: false };
    if (blob.size > maxBytes) return fail("too_big");
    return { ok: true, file: new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified }), recompressed: true };
  } finally {
    io.release(image);
  }
}
