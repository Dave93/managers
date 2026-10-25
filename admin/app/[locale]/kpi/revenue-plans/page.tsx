"use client";
// План выручки по филиалам на месяц: таблица с правкой и подсказка «от прошлого года».
import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@admin/components/ui/alert-dialog";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type RevenuePlanRow, type RevenueSuggestRow } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { formatSum } from "@admin/lib/kpi/format";
import { calendarPeriod, monthLabel } from "@admin/lib/kpi/periods";
import {
  applySuggestions,
  parseGrowth,
  planChanges,
  planDraft,
  planPeriods,
  suggestSummary,
  type PlanDraft,
} from "@admin/lib/kpi/revenue-plans";
import { KpiBadge } from "../_components/kpi-badge";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk } from "../_components/use-kpi";

export default function RevenuePlansPage() {
  return (
    <ScreenGate screen="revenue_plans">
      <RevenuePlansScreen />
    </ScreenGate>
  );
}

function RevenuePlansScreen() {
  const now = useMemo(() => new Date(), []);
  const options = useMemo(() => planPeriods(now), [now]);
  const [period, setPeriod] = useState(() => calendarPeriod(now));

  // Без фонового обновления при возврате на вкладку: черновик живёт отдельно и не должен ехать под руками.
  const plans = useQuery<RevenuePlanRow[], Error>({
    queryKey: qk.revenuePlans(period),
    queryFn: () => kpiApi.revenuePlans.list(period),
    retry: shouldRetry,
    refetchOnWindowFocus: false,
  });
  const load = loadErrors(plans);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">План выручки · {monthLabel(period)}</h1>
        <PeriodSelect value={period} onChange={(v) => v && setPeriod(v)} options={options} className="w-44" />
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking)}
        </p>
      ) : !plans.data ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        // key: при смене месяца черновик и подсказки начинаются заново.
        <PlanEditor key={period} period={period} rows={plans.data} />
      )}
    </div>
  );
}

function PlanEditor({ period, rows }: { period: string; rows: RevenuePlanRow[] }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PlanDraft>(() => planDraft(rows));
  const [growth, setGrowth] = useState("10");
  const [growthError, setGrowthError] = useState(false);
  const [base, setBase] = useState<Record<string, RevenueSuggestRow>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const saved = useMemo(() => planDraft(rows), [rows]);
  const baseLabel = Object.values(base)[0]?.base_period;

  // mode: «Заполнить» пишет только в пустые поля, «Заменить все» — во все
  const suggest = useMutation({
    mutationFn: (v: { g: number; mode: "empty" | "all" }) => kpiApi.revenuePlans.suggest(period, v.g),
    onSuccess: (list, v) => {
      const r = applySuggestions(draft, list, v.mode);
      setDraft(r.draft);
      setBase(Object.fromEntries(list.map((s) => [s.terminal_id, s])));
      setIssues([]);
      toast.success(suggestSummary(r));
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  const runSuggest = (mode: "empty" | "all") => {
    if (suggest.isPending) return;
    const g = parseGrowth(growth);
    setGrowthError(g === null);
    if (g === null) return;
    suggest.mutate({ g, mode });
  };

  // «Заменить все» стирает введённое руками: сначала подтверждение, рост проверяем до диалога
  const askReplace = () => {
    if (suggest.isPending) return;
    const g = parseGrowth(growth);
    setGrowthError(g === null);
    if (g !== null) setReplaceOpen(true);
  };

  // Защёлка: второй тап до ответа сервера запросом не уходит.
  const saving = useRef(false);
  const save = useMutation({
    mutationFn: (items: Parameters<typeof kpiApi.revenuePlans.save>[1]) => kpiApi.revenuePlans.save(period, items),
    onSuccess: async (list, items) => {
      qc.setQueryData(qk.revenuePlans(period), list);
      setDraft(planDraft(list));
      toast.success(`План сохранён: ${items.length}`);
      await qc.invalidateQueries({ queryKey: qk.branchAll });
    },
    // Черновик остаётся: HR исправит поле и нажмёт ещё раз.
    onError: (e) => toast.error(kpiErrorText(e)),
    onSettled: () => {
      saving.current = false;
    },
  });

  const onSave = () => {
    if (saving.current || save.isPending) return;
    const { items, errors } = planChanges(draft, rows);
    setIssues(errors);
    if (errors.length > 0) return;
    if (items.length === 0) {
      toast.message("Нет изменений");
      return;
    }
    saving.current = true;
    save.mutate(items);
  };

  const busy = save.isPending;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 rounded-lg border p-3">
        <Label htmlFor="rp-growth">Заполнить от прошлого года</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="rp-growth"
            inputMode="decimal"
            aria-label="Рост, %"
            placeholder="Рост, %"
            className="h-11 w-32"
            value={growth}
            disabled={suggest.isPending}
            onChange={(e) => {
              setGrowth(e.target.value);
              setGrowthError(false);
            }}
          />
          <Button type="button" variant="outline" className="h-11" disabled={suggest.isPending || busy} onClick={() => runSuggest("empty")}>
            {suggest.isPending && suggest.variables?.mode === "empty" ? "Считаем…" : "Заполнить от прошлого года"}
          </Button>
          <Button type="button" variant="outline" className="h-11" disabled={suggest.isPending || busy} onClick={askReplace}>
            {suggest.isPending && suggest.variables?.mode === "all" ? "Считаем…" : "Заменить все"}
          </Button>
        </div>
        {growthError && (
          <p role="alert" className="text-xs text-destructive">
            Рост — число от −50 до 200
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Выручка того же месяца год назад, умноженная на рост. Результат округляется до 1 000 сум. «Заполнить» трогает только пустые
          поля, «Заменить все» — все, где есть выручка прошлого года
        </p>
      </div>

      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить все планы?</AlertDialogTitle>
            <AlertDialogDescription>
              Введённые суммы заменятся подсказкой от прошлого года. Филиалы без выручки прошлого года не изменятся. В базу попадёт
              после «Сохранить»
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Отмена</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={() => runSuggest("all")}>
              Заменить все
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {rows.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">Нет филиалов, для которых можно задать план</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Филиал</TableHead>
                <TableHead className="text-right">{baseLabel ? `Выручка ${monthLabel(baseLabel)}` : "Выручка год назад"}</TableHead>
                <TableHead>План, сум</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const changed = (draft[r.terminal_id] ?? "") !== (saved[r.terminal_id] ?? "");
                const b = base[r.terminal_id];
                return (
                  <TableRow key={r.terminal_id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{r.terminal_name ?? "Филиал без названия"}</span>
                        {!r.has_iiko && <KpiBadge tone="gray">нет связи с iiko</KpiBadge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {b ? formatSum(b.base_revenue) : ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          inputMode="numeric"
                          aria-label={`План, сум: ${r.terminal_name ?? "Филиал"}`}
                          className="h-11 w-40 sm:h-9"
                          value={draft[r.terminal_id] ?? ""}
                          disabled={busy}
                          onChange={(e) => setDraft((cur) => ({ ...cur, [r.terminal_id]: e.target.value }))}
                        />
                        {changed && <span className="text-xs whitespace-nowrap text-amber-700">не сохранено</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {issues.length > 0 && (
        <ul role="alert" className="list-inside list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {issues.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <Button type="button" className="h-11" disabled={busy || rows.length === 0} onClick={onSave}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </Button>

      <p className="text-xs text-muted-foreground">
        План нужен для показателя «Продажи к плану». Пустое поле удаляет план филиала. Новый план учитывается со следующего пересчёта
      </p>
    </div>
  );
}
