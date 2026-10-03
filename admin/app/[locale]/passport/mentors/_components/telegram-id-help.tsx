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
import { cn } from "@admin/lib/utils";

export function TelegramIdHelp({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
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
          <b>Где менеджер берёт свой Telegram ID.</b> Пусть откроет Telegram,
          напишет{" "}
          <code className="rounded bg-background px-1 py-px font-mono text-[11px]">
            /start
          </code>{" "}
          боту{" "}
          <code className="rounded bg-background px-1 py-px font-mono text-[11px]">
            @userinfobot
          </code>{" "}
          (подойдёт и{" "}
          <code className="rounded bg-background px-1 py-px font-mono text-[11px]">
            @getmyid_bot
          </code>
          ) — в ответ придёт число вида{" "}
          <span className="font-mono text-[11px]">123456789</span>. Это и есть
          ID.
        </p>
        {!compact && (
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>
              ID — это <b>число</b>, а не <span className="font-mono">@username</span>{" "}
              и не номер телефона. Ник можно поменять, ID остаётся прежним.
            </li>
            <li>
              Нужен ID <b>того самого аккаунта</b>, с которого менеджер будет
              заходить в мини-апп: привязка даёт доступ аккаунту, а не человеку.
            </li>
            <li>
              Пока привязки нет, менеджер не сможет открыть мини-апп вообще —
              стажёр входит по QR, а у наставника QR нет.
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
