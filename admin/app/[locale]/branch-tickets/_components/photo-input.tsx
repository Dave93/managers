"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";

import { cn } from "@admin/lib/utils";
import { Button } from "@components/ui/buttonOrigin";
import {
  JPEG_QUALITY,
  MAX_PHOTOS,
  preparePhoto,
  type PhotoIO,
} from "@admin/lib/tickets-create";

export type PickedPhoto = {
  id: string;
  // Что уйдёт на сервер: после сжатия или оригинал.
  file: File;
  // Адрес превью (blob:); освобождает владелец списка через revokePhoto.
  url: string;
  recompressed: boolean;
};

export function revokePhoto(p: PickedPhoto) {
  try {
    URL.revokeObjectURL(p.url);
  } catch {
    // нечего освобождать
  }
}

// Браузерная часть сжатия. Через <img>, а не createImageBitmap: элемент
// применяет EXIF-ориентацию и при отрисовке, и в naturalWidth/Height, поэтому
// портретный кадр с планшета не ложится набок после перекодирования (canvas
// метаданные теряет). Холст белый под кадром: PNG с прозрачностью иначе стал бы
// чёрным в JPEG.
const urls = new WeakMap<HTMLImageElement, string>();

// Предел на каждый шаг обработки. Без него зависший разбор кадра (бывает, когда
// вкладка ушла в фон или браузер подавился файлом) оставил бы счётчик
// «обрабатываем» навсегда: кнопка отправки отключена, а убрать кадр в работе
// нельзя. По истечении шаг считается неудачей и файл отклоняется с причиной.
const STEP_TIMEOUT_MS = 30_000;
function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${what}`)), STEP_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
const browserIO: PhotoIO<HTMLImageElement> = {
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
        "decode"
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
    const blob = await withTimeout(
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)),
      "toBlob"
    );
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

let seq = 0;

// «Снять / Выбрать», превью с крестиками, счётчик «N из 5». Сжатие и проверка
// «это картинка» делаются при выборе, а не при отправке: нечитаемый файл
// отклоняется сразу с причиной, и в запрос идёт только то, что уже готово.
// Две скрытые кнопки выбора вместо одной: capture="environment" открывает
// камеру и обходит галерею, так что «Выбрать» нужен без него и с multiple.
export function PhotoInput({
  photos,
  onAdd,
  onRemove,
  processing,
  onBusy,
  disabled,
  initialNotes,
}: {
  photos: PickedPhoto[];
  // Сколько файлов сейчас жмётся; счёт ведёт владелец, чтобы кнопка отправки
  // видела то же число. Владельцу уходит ПРИРАЩЕНИЕ, а не итог: цикл разбора,
  // переживший свой экземпляр (размонтирование), иначе затирал бы счёт новой
  // партии своим устаревшим итогом.
  processing: number;
  onAdd: (added: PickedPhoto[]) => void;
  onRemove: (id: string) => void;
  onBusy: (delta: number) => void;
  disabled?: boolean;
  // Только для проверки отрисовки: сообщения об отклонённых файлах.
  initialNotes?: string[];
}) {
  const [notes, setNotes] = useState<string[]>(initialNotes ?? []);
  // Занятые места считаются синхронно: пока файлы жмутся, props ещё старые.
  const inflight = useRef(processing);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const setBusy = (delta: number) => {
    inflight.current += delta;
    onBusy(delta);
  };

  const handle = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    const free = Math.max(0, MAX_PHOTOS - photosRef.current.length - inflight.current);
    const take = files.slice(0, free);
    const problems: string[] = [];
    if (files.length > take.length) {
      // Места считаются на момент выбора, ещё до разбора файлов: если часть
      // выбранного окажется негодной, место освободится, поэтому текст не
      // утверждает, что лимит исчерпан, и говорит, что делать.
      problems.push(
        `Выбрано файлов: ${files.length}, свободных мест было ${free} (всего ${MAX_PHOTOS}). Последние ${files.length - take.length} не взяты: выберите их ещё раз, если место освободится`
      );
    }
    if (take.length === 0) {
      setNotes(problems);
      return;
    }
    setBusy(take.length);
    for (const f of take) {
      let out;
      try {
        out = await preparePhoto(f, browserIO);
      } catch {
        out = { ok: false as const, error: `${f.name || "файл"}: не удалось обработать` };
      }
      if (out.ok) {
        // Каждая готовая фотография попадает в список сразу, не ждём остальные.
        onAdd([{ id: `p${++seq}`, file: out.file, url: URL.createObjectURL(out.file), recompressed: out.recompressed }]);
      } else {
        problems.push(out.error);
      }
      setBusy(-1);
    }
    setNotes(problems);
  };

  const full = photos.length + processing >= MAX_PHOTOS;
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    // Тот же файл можно выбрать повторно только после сброса значения.
    void handle(list).finally(() => {
      try {
        e.target.value = "";
      } catch {
        // старые Safari
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className="h-12 px-6 text-base"
          disabled={disabled || full}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-5" /> Снять
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 px-6 text-base"
          disabled={disabled || full}
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus className="size-5" /> Выбрать
        </Button>
        <p className="text-base tabular-nums text-muted-foreground" aria-live="polite">
          {photos.length} из {MAX_PHOTOS}
          {processing > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden /> обрабатываем {processing}
            </span>
          )}
        </p>
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" onChange={onPick} />
        <input ref={galleryRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={onPick} />
      </div>

      {notes.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {photos.map((p, i) => (
            <li key={p.id} className="relative">
              {/* blob: адрес нельзя отдать next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Фото ${i + 1}`} className={cn("size-28 rounded-lg border object-cover")} />
              <button
                type="button"
                aria-label={`Убрать фото ${i + 1}`}
                disabled={disabled}
                onClick={() => onRemove(p.id)}
                className="absolute -right-2 -top-2 flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background shadow">
                  <X className="size-4" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
