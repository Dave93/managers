"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { attachmentUrl, type AttachmentRow } from "@admin/lib/tickets-api";

// Файл отдаёт авторизованный роут; он может ответить 404, если строка в базе
// есть, а файла на диске нет — так бывает после ручной чистки каталога.
// Показать разбитую картинку вместо карточки нельзя: человек решит, что
// сломался весь экран.
function Thumb({ a, onOpen }: { a: AttachmentRow; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground">
        <ImageOff className="size-5" />
        <span className="text-[11px]">нет файла</span>
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="size-24 overflow-hidden rounded-md border">
      {/* next/image здесь не годится: файл отдаёт авторизованный роут, а
          оптимизатор Next ходит за картинкой сам и без cookie сессии. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachmentUrl(a.id)}
        alt=""
        className="size-full object-cover"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

export function PhotoStrip({
  title,
  items,
  empty,
}: {
  title: string;
  items: AttachmentRow[];
  empty: string;
}) {
  const [full, setFull] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((a) => (
            <Thumb key={a.id} a={a} onOpen={() => setFull(attachmentUrl(a.id))} />
          ))}
        </div>
      )}
      {full && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setFull(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={full} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </section>
  );
}
