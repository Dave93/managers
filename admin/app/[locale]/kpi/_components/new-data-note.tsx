import React from "react";
import { Link } from "@admin/i18n/routing";
import { NEW_DATA_LINK_TEXT } from "@admin/lib/kpi/branch";

/** После расчёта появились новые проверки, планы или импорт посещаемости: балл ещё без них. href — на «Сеть», где «Пересчитать». */
export function NewDataNote({ text, href }: { text: string; href: string | null }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span>{text}</span>
      {href && (
        <Link href={href} className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">
          {NEW_DATA_LINK_TEXT}
        </Link>
      )}
    </div>
  );
}
