"use client";

// Карточка заявки в списке филиала. Вся карточка одна кнопка: на планшете
// попасть в мелкую ссылку с номером тяжелее, чем в блок на пол-экрана.
//
// Точка непрочитанного: showUnreadDot(row), то есть событие новее manager_seen_at
// или отметки нет вовсе. Сама карточка markSeen НЕ вызывает: список листают, а
// «филиал посмотрел» утверждает только открытая панель (accept-panel.tsx).

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@admin/lib/utils";
import { attachmentUrl, type TicketRow } from "@admin/lib/tickets-api";
import { showUnreadDot } from "@admin/lib/tickets-branch";
import { PriorityBadge, StatusBadge, WaitingFor, parseTs } from "@admin/components/tickets/status";

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const ms = parseTs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Превью лежит за авторизованным роутом и может не найтись на диске: тогда
// вместо разбитой картинки значок, а карточка остаётся рабочей.
function Preview({ id }: { id: string | null }) {
  const t = useTranslations("branchTickets.card");
  const [broken, setBroken] = useState(false);
  if (!id || broken) {
    return (
      <div
        className="flex size-20 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground"
        title={id ? t("fileNotFound") : t("noPhoto")}
      >
        <ImageOff className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    // next/image не годится: файл отдаёт авторизованный роут, а оптимизатор Next
    // ходит за картинкой сам и без cookie сессии.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attachmentUrl(id)}
      alt=""
      className="size-20 shrink-0 rounded-md border object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export function UnreadDot() {
  const t = useTranslations("branchTickets.card");
  return (
    <span className="inline-flex items-center" title={t("hasNew")}>
      <span aria-hidden className="size-3 rounded-full bg-blue-600 ring-2 ring-blue-600/25" data-unread-dot />
      <span className="sr-only">{t("hasNew")}</span>
    </span>
  );
}

export function BranchTicketCard({
  row,
  symptom,
  branchName,
  finished,
  highlighted,
  onOpen,
}: {
  row: TicketRow;
  symptom: string | null;
  // Подпись филиала, когда у менеджера их несколько; иначе null.
  branchName: string | null;
  // Закрытая или отменённая: вместо «висит» показываем статус и дату закрытия.
  finished: boolean;
  highlighted: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("branchTickets.card");
  const unread = showUnreadDot(row);
  const closedOn = row.status === "closed" ? fmtDate(row.closed_at) : null;
  return (
    <button
      type="button"
      id={`ticket-${row.id}`}
      data-highlighted={highlighted ? "true" : undefined}
      onClick={() => onOpen(row.id)}
      className={cn(
        "flex min-h-28 w-full items-start gap-3 rounded-lg border bg-card p-3 text-left outline-none transition-colors",
        "hover:bg-muted/40 active:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        highlighted && "border-primary ring-2 ring-primary/60"
      )}
    >
      <Preview id={row.preview_attachment_id} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-base font-semibold tabular-nums">{row.number}</span>
          {unread && <UnreadDot />}
          {finished && <StatusBadge status={row.status} />}
          <PriorityBadge priority={row.priority} />
        </span>
        <span className="block text-base leading-snug break-words">
          {row.type_name ?? t("typeDeleted")}
          {symptom ? <span className="text-muted-foreground"> · {symptom}</span> : null}
        </span>
        {branchName && <span className="block text-sm text-muted-foreground">{branchName}</span>}
        <span className="block text-sm text-muted-foreground">
          {row.executor_name ? t("tookBy", { name: row.executor_name }) : t("noExecutor")}
        </span>
        <span className="block text-sm text-muted-foreground">
          {finished ? (
            closedOn ? t("closedOn", { date: closedOn }) : null
          ) : (
            <>
              {t("waiting")}{" "}
              <WaitingFor
                status={row.status}
                created_at={row.created_at}
                assigned_at={row.assigned_at}
                done_at={row.done_at}
              />
            </>
          )}
        </span>
      </span>
    </button>
  );
}
