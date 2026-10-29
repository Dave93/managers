"use client";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime, formatQty } from "@admin/lib/inventory/money";
import type { ReconBranchEdit, ReconEvent } from "@backend/modules/inventory/reconcile/types";

function EventText({ e }: { e: ReconEvent }) {
  const t = useTranslations("inventory.reconcile");
  const p = e.payload ?? {};
  switch (e.type) {
    case "fetched":
      return (
        <span>
          {t("event.fetched", { num: p.num ?? "" })}
          {p.changed_total > 0 && <> · {t("event.changed", { count: p.changed_total })}</>}
          {Array.isArray(p.changed) && p.changed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {p.changed.slice(0, 50).map((c: any) => (
                <li key={c.product_id}>
                  {c.product_name}: {formatQty(c.qty_before)} → {formatQty(c.qty_after)}
                </li>
              ))}
            </ul>
          )}
        </span>
      );
    case "doc_missing":
      return <span className="text-orange-600">{t("event.doc_missing", { num: p.num ?? "" })}</span>;
    case "doc_chosen":
      return <span>{t("event.doc_chosen", { num: p.num ?? "" })}</span>;
    case "status_changed":
      return (
        <span>
          {t("event.status_changed", { to: t(`status.${p.to}`) })}
          {p.comment && <span className="text-muted-foreground"> — {p.comment}</span>}
        </span>
      );
    default:
      return <span>{t("event.calculated")}</span>;
  }
}

export function ReconLog({ events, edits }: { events: ReconEvent[]; edits: ReconBranchEdit[] }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {[...events].reverse().map((e) => (
          <li key={e.id} className="text-sm">
            <span className="mr-2 text-muted-foreground">{formatDateTime(e.created_at, locale)}</span>
            {e.user_name && <span className="mr-2">{e.user_name}:</span>}
            <EventText e={e} />
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-2 font-medium">{t("edits.title")}</h3>
        {edits.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("edits.none")}</div>
        ) : (
          <ul className="space-y-1">
            {edits.map((x, i) => (
              <li key={i} className="text-sm">
                <span className="mr-2 text-muted-foreground">{formatDateTime(x.at, locale)}</span>
                {x.user_name} — {t(`edits.${x.kind}`, { qty: formatQty(x.qty) })}
                {x.product_name && <span className="text-muted-foreground"> · {x.product_name}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
