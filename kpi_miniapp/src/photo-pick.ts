// Браузерная часть подготовки фото: декодирование через <img> (ради ориентации EXIF), холст с белой
// подложкой, toBlob. Порт browserIO из admin/app/[locale]/kpi/_components/photo-input.tsx без изменения
// поведения. На каждый шаг 30 с: зависшее декодирование — отказ, а не вечное «Готовим фото…».
import { JPEG_QUALITY, type PhotoIO } from "./photo-prepare";

const STEP_MS = 30_000;
const urls = new Map<HTMLImageElement, string>();

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what)), STEP_MS);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export const browserIO: PhotoIO<HTMLImageElement> = {
  async decode(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await withTimeout(
        (async () => {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("decode"));
            img.src = url;
          });
          // onload у части браузеров приходит до полного разбора больших кадров.
          if (typeof img.decode === "function") await img.decode();
        })(),
        "decode",
      );
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      throw new Error("no size");
    }
    urls.set(img, url);
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  },
  async encode(img, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await withTimeout(new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)), "toBlob");
    // Safari держит память холста, пока он не обнулён.
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  },
  release(img) {
    const url = urls.get(img);
    if (url) URL.revokeObjectURL(url);
    urls.delete(img);
  },
};
