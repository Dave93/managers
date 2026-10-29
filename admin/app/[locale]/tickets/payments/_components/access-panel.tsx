"use client";

import { ShieldAlert } from "lucide-react";

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
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2.5">
          <p className="text-[14px] font-semibold leading-tight">Нет доступа к очереди «К оплате»</p>
          <p className="max-w-xl text-[12.5px] leading-snug text-muted-foreground">
            {serverDenied ? "Сервер ответил отказом (403). " : ""}
            Экрану нужны два права:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
              {PAYMENT_RIGHTS.approve}
            </code>{" "}
            (утверждать и отклонять оплату) и{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
              {PAYMENT_RIGHTS.list}
            </code>{" "}
            (читать заявки). У вашей роли не хватает:
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
            Попросите администратора добавить их роли в форме роли, затем перезагрузите страницу.
          </p>
        </div>
      </div>
    </div>
  );
}
