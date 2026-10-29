"use client";

import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

// Права экрана. Чтение очереди требует tickets.list (GET /tickets), решение по
// оплате — tickets.payment.approve. Тексты панели копируют в форму роли, поэтому
// названия прав стоят дословно.
export const PAYMENT_RIGHTS = {
  list: "tickets.list",
  approve: "tickets.payment.approve",
} as const;

export function AccessPanel({
  missing,
  serverDenied,
}: {
  missing: string[];
  // true: отказ пришёл от сервера (403), а не из списка прав сессии.
  serverDenied?: boolean;
}) {
  const t = useTranslations("ticketsUi.payments.access");
  const code = (chunks: React.ReactNode) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{chunks}</code>
  );
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2.5">
          <p className="text-[14px] font-semibold leading-tight">{t("title")}</p>
          <p className="max-w-xl text-[12.5px] leading-snug text-muted-foreground">
            {serverDenied ? `${t("serverDenied")} ` : ""}
            {t.rich("body", {
              approve: PAYMENT_RIGHTS.approve,
              list: PAYMENT_RIGHTS.list,
              code,
            })}
          </p>
          <ul className="space-y-1">
            {missing.map((p) => (
              <li key={p}>
                <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                  {p}
                </code>
              </li>
            ))}
          </ul>
          <p className="max-w-xl text-[12px] leading-snug text-muted-foreground">
            {t("hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
