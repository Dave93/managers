"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { attachmentUrl, type AttachmentRow } from "@admin/lib/tickets-api";

// Файл отдаёт авторизованный роут; он может ответить 404, если строка в базе
// есть, а файла на диске нет — так бывает после ручной чистки каталога.
// Показать разбитую картинку вместо карточки нельзя: человек решит, что
// сломался весь экран.
function Thumb({ a, onOpen }: { a: AttachmentRow; onOpen: () => void }) {
  const t = useTranslations("ticketsUi.photo");
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground">
        <ImageOff className="size-5" />
        <span className="text-[11px]">{t("noFile")}</span>
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

// Полноэкранный просмотр живёт внутри панели карточки (Radix Dialog). Esc по
// умолчанию уходит в DismissableLayer панели и закрывает всю карточку, то есть
// человек теряет панель, пытаясь убрать фото. Поэтому Esc ловим на window в
// фазе перехвата, раньше слушателя панели на document, и гасим событие: закрыть
// должен только просмотр. Фокус уходит на кнопку закрытия и после закрытия
// возвращается туда, откуда просмотр открыли.
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const t = useTranslations("ticketsUi.photo");
  const [broken, setBroken] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
    // onClose приходит новой функцией на каждый рендер, а подписка должна
    // жить, пока просмотр открыт.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("photo")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label={t("closePhoto")}
        onClick={onClose}
        className="absolute right-4 top-4 rounded-md bg-black/50 p-2 text-white outline-none hover:bg-black/70 focus-visible:ring-[3px] focus-visible:ring-white/60"
      >
        <X className="size-5" />
      </button>
      {broken ? (
        <div className="flex flex-col items-center gap-2 text-white/80">
          <ImageOff className="size-8" />
          <span className="text-sm">{t("noFile")}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="max-h-full max-w-full object-contain"
          onError={() => setBroken(true)}
        />
      )}
    </div>
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
      {full && <Lightbox src={full} onClose={() => setFull(null)} />}
    </section>
  );
}
