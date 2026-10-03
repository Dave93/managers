"use client";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { formatQty } from "@admin/lib/inventory/qty";
import type { OverlayLine } from "@admin/lib/inventory/queue";

export function EntriesPopover({
  line,
  viewerId,
  canDeleteAny,
  editable,
  onDelete,
}: {
  line: OverlayLine;
  viewerId: string;
  canDeleteAny: boolean;
  editable: boolean;
  onDelete: (entryId: string) => void;
}) {
  const t = useTranslations("inventory.line");
  const locale = useLocale();
  const timeLocale = locale === "uz-Latn" ? "uz" : locale;
  if (line.entries.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-w-[44px] min-h-[44px] px-2 text-left tabular-nums font-medium"
          aria-label={t("entries")}
        >
          {formatQty(line.total)}
          {line.entries.length > 1 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-xs">
              {line.entries.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="text-sm font-medium mb-2">{t("entries")}</div>
        <ul className="space-y-1">
          {line.entries.map((e) => {
            const time = new Date(e.client_created_at).toLocaleTimeString(timeLocale, { hour: "2-digit", minute: "2-digit", hour12: false });
            const deletable = editable && (canDeleteAny || e.created_by === viewerId);
            return (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="tabular-nums">
                  {formatQty(e.qty)} — {e.created_by_name} {time}
                  {e.pending && <span className="ml-1 text-orange-600">({t("pending")})</span>}
                </span>
                {deletable && (
                  <button
                    type="button"
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-destructive"
                    onClick={() => onDelete(e.id)}
                    aria-label={t("delete")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
