"use client";

// "Where does a manager get their Telegram ID?" — the single question this
// page will be asked most, so the answer lives on the screen instead of in
// somebody's head.
//
// The ID is a NUMBER, permanent for the account, and it is not discoverable
// from the Telegram UI: the standard way is to ask one of the public
// id-reporting bots. That is written out literally, with the two things people
// actually get wrong called out — @username is not an ID, and it has to be the
// account the manager will really open the miniapp from (personal phone, not
// the branch's shared one, unless the branch phone IS the working account).

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";

export function TelegramIdHelp({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("passportUi.mentors.telegramHelp");
  const code = (chunks: React.ReactNode) => (
    <code className="rounded bg-background px-1 py-px font-mono text-[11px]">
      {chunks}
    </code>
  );
  const mono = (chunks: React.ReactNode) => (
    <span className="font-mono">{chunks}</span>
  );
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-[12px] leading-snug",
        className
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p>
          {t.rich("where", {
            b: (c) => <b>{c}</b>,
            code,
            mono: (c) => <span className="font-mono text-[11px]">{c}</span>,
          })}
        </p>
        {!compact && (
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>{t.rich("number", { b: (c) => <b>{c}</b>, mono })}</li>
            <li>{t.rich("account", { b: (c) => <b>{c}</b> })}</li>
            <li>{t("noBinding")}</li>
          </ul>
        )}
      </div>
    </div>
  );
}
