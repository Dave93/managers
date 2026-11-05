"use client";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { useRouter } from "@admin/i18n/routing";
import { kpiApi, type PeopleRow } from "@admin/lib/kpi-api";
import { shouldRetry } from "@admin/lib/kpi/errors";
import { matchesQuery, nameOf } from "@admin/lib/kpi/timesheet";
import { qk } from "../../../_components/use-kpi";

/** Поиск другого сотрудника: список подтягивается при первом фокусе, выбор открывает его карточку за тот же месяц. */
export function EmployeeSwitch({ period, currentId }: { period: string; currentId: string }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [armed, setArmed] = useState(false);
  const people = useQuery<PeopleRow[], Error>({
    queryKey: qk.people(period),
    queryFn: () => kpiApi.people(period),
    enabled: armed,
    retry: shouldRetry,
    staleTime: 60_000,
  });
  const found = useMemo(() => (q.trim() ? (people.data ?? []).filter((r) => r.id !== currentId && matchesQuery(r, q)).slice(0, 8) : []), [people.data, q, currentId]);
  return (
    <div className="relative w-full sm:w-64">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setArmed(true)}
        placeholder={t("switch.placeholder")}
        aria-label={t("switch.label")}
        className="h-9"
      />
      {q.trim() !== "" && people.data && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {found.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">{t("switch.none")}</li>
          ) : (
            found.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/kpi/employee/${r.id}?period=${period}`)}
                  className="block w-full rounded px-3 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="block">{nameOf(r)}</span>
                  <span className="block text-xs text-muted-foreground">{[r.staff_role_name, r.terminal_name].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
