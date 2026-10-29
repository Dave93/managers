"use client";

import { RefreshCw, ShieldAlert, Store, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@components/ui/buttonOrigin";

// Право экрана: tickets.create (и для самого POST, и для GET /ticket_types).
// Какие филиалы у менеджера, решает GET /users/me (снимок сессии, права не
// нужно). users_terminals.list экрану не обязателен: из него берутся только
// названия филиалов, а без него подпись остаётся короткой («Филиал <id>»).
// Название права стоит дословно: текст панели копируют в форму роли.
export const CREATE_RIGHTS = {
  create: "tickets.create",
} as const;

export function NoAccessPanel({
  missing,
  serverDenied,
}: {
  missing: string[];
  // true: отказ пришёл от сервера (403), а не из списка прав сессии.
  serverDenied?: boolean;
}) {
  const t = useTranslations("branchTickets.gates");
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <ShieldAlert className="mt-0.5 size-6 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2.5">
          <p className="text-base font-semibold leading-tight">{t("noAccessTitle")}</p>
          <p className="max-w-xl text-sm leading-snug text-muted-foreground">
            {serverDenied ? `${t("serverDenied")} ` : ""}
            {t.rich("noAccessBody", {
              right: CREATE_RIGHTS.create,
              code: (chunks) => (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">{chunks}</code>
              ),
            })}
          </p>
          <ul className="space-y-1">
            {missing.map((p) => (
              <li key={p}>
                <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{p}</code>
              </li>
            ))}
          </ul>
          <p className="max-w-xl text-sm leading-snug text-muted-foreground">
            {t("noAccessHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

// Пункт 2 из Review Focus: сессия без закреплённого филиала (офисная роль
// несёт пустой список терминалов). Выбирать из сотни филиалов тут нечего,
// а запрос без terminal_id сервер встретил бы 403, который читается как
// поломка. Формулировка из плана.
export function UnassignedPanel() {
  const t = useTranslations("branchTickets.gates");
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <Store className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-2">
          <p className="text-base font-semibold leading-tight">
            {t("unassignedTitle")}
          </p>
          <p className="max-w-xl text-sm leading-snug text-muted-foreground">
            {t("unassignedBody")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LoadFailedPanel({
  title,
  detail,
  onRetry,
  retrying,
}: {
  title: string;
  detail?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const t = useTranslations("branchTickets.gates");
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <TriangleAlert className="mt-0.5 size-6 shrink-0 text-amber-600" />
        <div className="min-w-0 space-y-3">
          <p className="text-base font-semibold leading-tight">{title}</p>
          {detail ? <p className="max-w-xl text-sm leading-snug text-muted-foreground">{detail}</p> : null}
          <Button type="button" variant="outline" className="h-11 px-5 text-base" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={retrying ? "animate-spin" : undefined} />
            {t("retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}
