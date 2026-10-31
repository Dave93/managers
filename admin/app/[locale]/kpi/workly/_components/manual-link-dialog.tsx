"use client";
// Ручная связь нашего сотрудника с записью Workly: поиск по имени среди сотрудников Workly
// организации (не больше 50 результатов), выбор записи и «Связать». Первый поиск на холодном
// кэше сервера идёт до ~30 секунд, поэтому индикатор загрузки с этой подсказкой обязателен.

import React, { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { kpiApi, type WorklyPersonRow } from "@admin/lib/kpi-api";
import { shouldRetry } from "@admin/lib/kpi/errors";
import { searchSeed, shortId } from "@admin/lib/kpi/workly-view";
import { qk } from "../../_components/use-kpi";
import { useWorklyText } from "./workly-text";

/**
 * Наш сотрудник из строки отчёта: id и подпись этой строки. У строки «Не найден» подпись —
 * имя нашего сотрудника; у «Неоднозначно» — имя записи Workly (иногда с «(Workly: 12, 15)»),
 * имени нашего кандидата в отчёте нет.
 */
export type LinkTarget = { id: string; label: string; kind: "ambiguous" | "not_found" };

const MIN_SEARCH = 2;
const SEARCH_DELAY_MS = 400;
const SEARCH_LIMIT = 50;

export function ManualLinkDialog({
  organizationId,
  employee,
  onClose,
  onLinked,
}: {
  organizationId: string;
  /** null — окно закрыто. */
  employee: LinkTarget | null;
  onClose: () => void;
  /** Связь записана: строка отчёта помечается «связан вручную». */
  onLinked: (employeeId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={employee != null}
      onOpenChange={(open) => {
        // Пока запрос связи идёт, окно не закрывается.
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {/* key: у другого сотрудника поиск и выбор начинаются заново. */}
        {employee && (
          <LinkForm
            key={employee.id}
            organizationId={organizationId}
            employee={employee}
            onBusy={setBusy}
            onCancel={onClose}
            onLinked={onLinked}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({
  organizationId,
  employee,
  onBusy,
  onCancel,
  onLinked,
}: {
  organizationId: string;
  employee: LinkTarget;
  onBusy: (busy: boolean) => void;
  onCancel: () => void;
  onLinked: (employeeId: string) => void;
}) {
  const t = useTranslations("kpiScreens.workly");
  const tc = useTranslations("kpiScreens.common");
  const text = useWorklyText();
  const qc = useQueryClient();
  const inputId = useId();
  const radioName = useId();

  // Поиск начинается с имени из строки отчёта; запрос уходит через 400 мс после ввода.
  const [searchText, setSearchText] = useState(() => searchSeed(employee.label));
  const [search, setSearch] = useState(() => searchSeed(employee.label));
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const searching = search.length >= MIN_SEARCH;
  const found = useQuery<WorklyPersonRow[], Error>({
    queryKey: qk.worklyEmployees(organizationId, search),
    queryFn: () => kpiApi.workly.employees(organizationId, search),
    enabled: searching,
    retry: shouldRetry,
    staleTime: 5 * 60 * 1000,
  });
  const rows = searching ? found.data ?? [] : [];

  const [picked, setPicked] = useState<number | null>(null);
  const chosen = rows.find((p) => p.id === picked) ?? null;
  const [error, setError] = useState<unknown>(null);

  const link = useMutation({
    mutationFn: (worklyId: number) =>
      kpiApi.workly.link({ organization_id: organizationId, employee_id: employee.id, workly_id: worklyId }),
    onMutate: () => {
      setError(null);
      onBusy(true);
    },
    onSuccess: () => {
      toast.success(t("link.success"));
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      onLinked(employee.id);
    },
    onError: (e) => setError(e),
    onSettled: () => onBusy(false),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chosen && !link.isPending) link.mutate(chosen.id);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t("link.title")}</DialogTitle>
        <DialogDescription>
          {employee.kind === "ambiguous"
            ? t("link.descriptionAmbiguous", { name: employee.label, id: shortId(employee.id) })
            : t("link.description", { name: employee.label, id: shortId(employee.id) })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("link.search")}
        </label>
        <Input
          id={inputId}
          className="h-11"
          placeholder={t("link.searchPlaceholder")}
          value={searchText}
          disabled={link.isPending}
          autoComplete="off"
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      {!searching ? (
        <p className="text-sm text-muted-foreground">{t("link.minChars")}</p>
      ) : found.error ? (
        <p role="alert" className="text-sm text-destructive">
          {text.apiError(found.error)}
        </p>
      ) : found.isPending ? (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("link.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("link.notFound")}</p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("link.results")}</legend>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {rows.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2">
                  <input
                    type="radio"
                    name={radioName}
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={picked === p.id}
                    disabled={link.isPending}
                    onChange={() => setPicked(p.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words">{p.full_name || t("link.noName")}</span>
                    <span className="block text-xs text-muted-foreground break-words">
                      {p.tab_number ? t("link.tab", { tab: p.tab_number }) : t("link.noTab")}
                      {" · "}
                      {p.locations.length > 0
                        ? p.locations.map((l) => l.title || t("link.location", { id: String(l.id) })).join(", ")
                        : t("link.noLocations")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {rows.length >= SEARCH_LIMIT && <p className="text-xs text-muted-foreground">{t("link.limit")}</p>}
        </fieldset>
      )}

      {error != null && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {text.apiError(error)}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={link.isPending} onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" className="h-11" disabled={!chosen || link.isPending}>
          {link.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t("link.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
