"use client";

// A named, actionable "you cannot see this" screen.
//
// WHY THIS EXISTS: both gates below it used to render `<></>` when a
// permission was missing. A permission gap that renders nothing is
// indistinguishable from a broken deploy — HTTP 200, no console error, no
// redirect, every API call green, and a white screen. The person hitting it
// cannot tell whether to call IT or ask for access, and neither can the person
// they call. Naming the missing permission turns a multi-hour incident into a
// one-line request.
//
// Deliberately plain: this must render with no layout shell around it, because
// the case it exists for is "no layout shell was granted".

import { ShieldAlert } from "lucide-react";

export default function NoAccessNotice({
  title,
  missing,
  explanation,
}: {
  title: string;
  /** Permission slugs to name literally. Shown verbatim — they are what the
   *  administrator has to grant, so they must not be translated or prettified. */
  missing: string[];
  explanation: string;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-3">
            <h1 className="text-lg font-semibold leading-tight">{title}</h1>

            <p className="text-sm leading-snug text-muted-foreground">
              {explanation}
            </p>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                {missing.length === 1
                  ? "Не хватает права:"
                  : "Не хватает одного из прав:"}
              </p>
              <ul className="space-y-1">
                {missing.map((p) => (
                  <li key={p}>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
                      {p}
                    </code>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-sm leading-snug">
              Это не сбой системы и не поломка деплоя — страница загрузилась
              нормально. Обратитесь к администратору office-админки (HR или
              IT-отдел) и попросите добавить указанное право вашей роли. После
              выдачи права страницу нужно просто перезагрузить.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
