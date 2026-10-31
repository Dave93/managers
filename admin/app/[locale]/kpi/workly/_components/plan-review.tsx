"use client";
// Сверка сотрудников по одному прогону: счётчики, группы пунктов (свёрнуты, по 50 строк),
// исключения, блоки отчёта с ручной связью и «Применить» с подтверждением.
// Один компонент на прогон (key = run.id) и для planned, и для applied: ответ «Применить»
// показывается сразу и не теряется, когда прогон перечитывается уже как applied.

import React, { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
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
import { kpiApi, type PlanItem, type PlanKind, type RunRow, type WorklyApplyResult } from "@admin/lib/kpi-api";
import { PLAN_GROUP_ORDER, canApply, effectiveCounts, groupPlan, toggleExclusion } from "@admin/lib/kpi/workly";
import {
  GROUP_PAGE,
  changeSummary,
  confirmSummary,
  impliedSkips,
  shortId,
  skippedGroups,
  visibleItems,
  type ChangePart,
  type SkippedItem,
} from "@admin/lib/kpi/workly-view";
import { cn } from "@admin/lib/utils";
import { qk, useKpiTerminals } from "../../_components/use-kpi";
import { ManualLinkDialog, type LinkTarget } from "./manual-link-dialog";
import { useWorklyText } from "./workly-text";

type Props = {
  run: RunRow;
  organizationId: string;
  organizationName: string;
  /** «Проверить заново»: новый прогон проверки той же организации. */
  onRecheck: () => void;
  rechecking: boolean;
};

const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

export function PlanReview({ run, organizationId, organizationName, onRecheck, rechecking }: Props) {
  const t = useTranslations("kpiScreens.workly");
  const tc = useTranslations("kpiScreens.common");
  const text = useWorklyText();
  const qc = useQueryClient();
  const terminals = useKpiTerminals();

  const plan = run.plan;
  const items = useMemo(() => plan?.items ?? [], [plan]);
  const report = plan?.report;
  const editable = canApply(run);

  // Исключённые ключи живут, пока открыт этот прогон (новый прогон — новый key компонента).
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(NO_EXCLUSIONS);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<WorklyApplyResult | null>(null);
  const [applyError, setApplyError] = useState<unknown>(null);
  // Сотрудники, связанные вручную из строк отчёта: план это не обновляет до нового «Проверить».
  const [linked, setLinked] = useState<ReadonlySet<string>>(NO_EXCLUSIONS);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const latch = useRef(false);

  const activeExcluded = editable ? excluded : NO_EXCLUSIONS;
  // Переносы, которые бэкенд пропустит вместе с исключённой связью: в счётчиках и
  // подтверждении их нет. В apply уходит только то, что исключил человек.
  const implied = useMemo(
    () => (activeExcluded.size > 0 ? impliedSkips(items, activeExcluded) : NO_EXCLUSIONS),
    [items, activeExcluded]
  );
  const notApplied = useMemo(
    () => (implied.size > 0 ? new Set([...activeExcluded, ...implied]) : activeExcluded),
    [activeExcluded, implied]
  );
  const groups = useMemo(() => groupPlan(items), [items]);
  const counts = useMemo(() => effectiveCounts(items, notApplied), [items, notApplied]);
  const summary = confirmSummary(counts, activeExcluded.size);
  const byKey = useMemo(() => new Map(items.map((it) => [it.key, it])), [items]);

  const terminalName = useMemo(() => {
    const names = new Map((terminals.data ?? []).map((o) => [o.id, o.name]));
    // Неактивного филиала нет в списке KPI: тогда короткий хвост id.
    return (id: string | null) => (id == null ? "—" : names.get(id) ?? shortId(id));
  }, [terminals.data]);

  const onToggle = useCallback((key: string) => setExcluded((s) => toggleExclusion(s, key)), []);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.worklyStatus });
    qc.invalidateQueries({ queryKey: qk.worklyRun(run.id) });
    qc.invalidateQueries({ queryKey: qk.employeesAll });
  };

  const apply = useMutation({
    // Обёртка всегда шлёт exclude массивом, пустым без исключений (R27).
    mutationFn: () => kpiApi.workly.apply(run.id, excluded),
    onMutate: () => setApplyError(null),
    onSuccess: (res) => {
      setResult(res);
      setConfirmOpen(false);
      toast.success(t("plan.result.toast", { count: res.applied }));
      refresh();
    },
    onError: (e) => {
      setApplyError(e);
      setConfirmOpen(false);
      refresh();
    },
    onSettled: () => {
      latch.current = false;
    },
  });

  const submit = () => {
    if (latch.current || !editable || summary.total === 0) return;
    latch.current = true;
    apply.mutate();
  };

  // Итог: ответ «Применить» сразу, после перечитывания — из plan.applied / plan.skipped.
  const shownResult: WorklyApplyResult | null =
    result ?? (run.status === "applied" && plan?.applied ? { applied: plan.applied.length, skipped: plan.skipped ?? [] } : null);

  const describe = useCallback(
    (part: ChangePart): string => {
      switch (part.type) {
        case "deactivate":
          return t("plan.change.deactivate");
        case "activate":
          return t("plan.change.activate");
        case "link":
          return t("plan.change.link", { id: String(part.workly_id) });
        case "relink":
          return t("plan.change.relink", { from: part.from == null ? "—" : String(part.from), to: String(part.to) });
        case "terminal":
          return t("plan.change.terminal", { from: terminalName(part.from), to: terminalName(part.to) });
        case "position":
          return t("plan.change.position", { from: part.from ?? "—", to: part.to ?? "—" });
        case "tab":
          return t("plan.change.tab", { from: part.from ?? "—", to: part.to ?? "—" });
        case "create":
          return t("plan.change.create", {
            position: part.position ?? t("plan.noPosition"),
            terminal: terminalName(part.terminal_id),
          });
      }
    },
    [t, terminalName]
  );

  if (!plan) return <p className="text-sm text-muted-foreground">{t("plan.noPlan")}</p>;

  const reportCount = (report?.ambiguous.length ?? 0) + (report?.not_found.length ?? 0) + (report?.no_branch.length ?? 0);
  const nothing = items.length === 0 && reportCount === 0;

  return (
    <div className="space-y-4">
      {nothing ? (
        <p className="text-sm text-muted-foreground">{t("plan.empty")}</p>
      ) : (
        <ul aria-label={t("plan.countersAria")} className="flex flex-wrap gap-2 text-sm">
          {PLAN_GROUP_ORDER.filter((k) => counts[k] > 0).map((k) => (
            <li key={k} className="rounded-md border px-2.5 py-1">
              {t("plan.counter", { kind: t(`kinds.${k}`), count: counts[k] })}
            </li>
          ))}
          {reportCount > 0 && (
            <li className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-900">
              {t("plan.counter", { kind: t("report.heading"), count: reportCount })}
            </li>
          )}
          {activeExcluded.size > 0 && (
            <li className="rounded-md border border-dashed px-2.5 py-1">{t("plan.excludedCount", { count: activeExcluded.size })}</li>
          )}
        </ul>
      )}

      {shownResult && <ApplyResult result={shownResult} byKey={byKey} />}

      {run.status === "rolled_back" && plan.rolled_back && (
        <p className="rounded-md border p-3 text-sm">
          {t("plan.rolledBack", {
            restored: plan.rolled_back.restored,
            deleted: plan.rolled_back.deleted,
            deactivated: plan.rolled_back.deactivated,
          })}
        </p>
      )}

      {applyError != null && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive p-3 text-sm text-destructive">
          <p>{text.apiError(applyError)}</p>
          <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" disabled={rechecking} onClick={onRecheck}>
            {t("plan.recheck")}
          </Button>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-2">
          {groups.map((g) => {
            const off = editable ? countExcluded(g.items, notApplied) : 0;
            return (
              <Group
                key={g.kind}
                title={t(`kinds.${g.kind}`)}
                count={g.items.length}
                note={off > 0 ? t("plan.excludedCount", { count: off }) : null}
                items={g.items}
                render={(it) => (
                  <PlanRow
                    key={it.key}
                    item={it}
                    editable={editable}
                    excluded={excluded.has(it.key)}
                    implied={implied.has(it.key)}
                    onToggle={onToggle}
                    describe={describe}
                  />
                )}
              />
            );
          })}
        </div>
      )}

      {report && reportCount > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium">{t("report.heading")}</h5>
          {report.ambiguous.length > 0 && (
            <Group
              title={t("report.ambiguous")}
              count={report.ambiguous.length}
              hint={t("report.ambiguousHint")}
              items={report.ambiguous}
              render={(r) => (
                // Ограничение отчёта: у неоднозначной строки есть только подпись (имя записи Workly)
                // и id наших кандидатов, имён наших сотрудников в ней нет. Поэтому кнопка каждого
                // кандидата подписана общей подписью и коротким хвостом его id.
                <li key={`${r.workly_id}`} className="space-y-2 py-2">
                  <p className="text-sm font-medium break-words">{r.label}</p>
                  {r.employee_ids.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("report.noCandidates")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {r.employee_ids.map((id) =>
                        linked.has(id) ? (
                          <span key={id} className="inline-flex min-h-11 items-center text-sm text-green-700">
                            {t("report.linkedCandidate", { id: shortId(id) })}
                          </span>
                        ) : (
                          <Button
                            key={id}
                            type="button"
                            variant="outline"
                            // На узком экране подпись переносится, а не вылезает за карточку.
                            className="h-auto min-h-11 max-w-full whitespace-normal text-left"
                            aria-label={t("report.linkCandidateAria", { id: shortId(id), name: r.label })}
                            onClick={() => setLinkTarget({ id, label: r.label })}
                          >
                            {t("report.linkCandidate", { id: shortId(id) })}
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </li>
              )}
            />
          )}
          {report.not_found.length > 0 && (
            <Group
              title={t("report.notFound")}
              count={report.not_found.length}
              hint={t("report.notFoundHint")}
              items={report.not_found}
              render={(r) => (
                <li key={r.employee_id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-sm font-medium break-words">{r.label || shortId(r.employee_id)}</p>
                  {linked.has(r.employee_id) ? (
                    <span className="inline-flex min-h-11 items-center text-sm text-green-700">{t("report.linked")}</span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full sm:w-auto"
                      aria-label={t("report.linkAria", { name: r.label })}
                      onClick={() => setLinkTarget({ id: r.employee_id, label: r.label })}
                    >
                      {t("report.link")}
                    </Button>
                  )}
                </li>
              )}
            />
          )}
          {report.no_branch.length > 0 && (
            <Group
              title={t("report.noBranch")}
              count={report.no_branch.length}
              hint={t("report.noBranchHint")}
              items={report.no_branch}
              render={(r) => (
                <li key={r.workly_id} className="py-2 text-sm break-words">
                  {r.label || t("report.worklyRecord", { id: String(r.workly_id) })}
                </li>
              )}
            />
          )}
          {linked.size > 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("report.linkedHint")}
            </p>
          )}
        </div>
      )}

      {editable && (
        <div className="space-y-2 border-t pt-4">
          {summary.total === 0 && (
            <p className="text-sm text-muted-foreground">{items.length === 0 ? t("plan.nothingToApply") : t("plan.allExcluded")}</p>
          )}
          <Button
            type="button"
            className="h-11 w-full sm:w-auto"
            disabled={summary.total === 0 || apply.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("plan.apply")}
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          // Пока запрос идёт, окно не закрывается ни Esc, ни «Отмена».
          if (!apply.isPending) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm.title", { name: organizationName })}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1 text-sm">
            {summary.lines.map((l) => (
              <li key={l.kind}>{t("plan.counter", { kind: t(`kinds.${l.kind}`), count: l.count })}</li>
            ))}
          </ul>
          {summary.deactivate > 0 && (
            <p className="rounded-md border-2 border-destructive p-3 text-sm font-semibold text-destructive">
              {t("confirm.deactivate", { count: summary.deactivate })}
            </p>
          )}
          {summary.excluded > 0 && <p className="text-sm">{t("confirm.excluded", { count: summary.excluded })}</p>}
          {implied.size > 0 && <p className="text-sm">{t("confirm.implied", { count: implied.size })}</p>}
          {apply.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("confirm.submitting")}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={apply.isPending}>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={apply.isPending || summary.total === 0}
              onClick={(e) => {
                // Окно закрывается само только после ответа сервера.
                e.preventDefault();
                submit();
              }}
            >
              {t("confirm.submit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ManualLinkDialog
        organizationId={organizationId}
        employee={linkTarget}
        onClose={() => setLinkTarget(null)}
        onLinked={(employeeId) => {
          setLinked((s) => new Set(s).add(employeeId));
          setLinkTarget(null);
        }}
      />
    </div>
  );
}

function countExcluded(items: PlanItem[], excluded: ReadonlySet<string>): number {
  let n = 0;
  for (const it of items) if (excluded.has(it.key)) n++;
  return n;
}

/** Свёрнутая группа: заголовок с числом; раскрытая показывает первые GROUP_PAGE строк и «Показать все». */
function Group<T>({
  title,
  count,
  note,
  hint,
  items,
  render,
}: {
  title: string;
  count: number;
  note?: string | null;
  hint?: string;
  items: readonly T[];
  render: (item: T) => React.ReactNode;
}) {
  const t = useTranslations("kpiScreens.workly");
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const bodyId = useId();
  // Свёрнутая группа не рендерит строк вовсе: в плане бывают сотни пунктов одного вида.
  const shown = open ? visibleItems(items, all) : [];

  return (
    <div className="rounded-md border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 break-words">
          {title}
          {note && <span className="ml-2 font-normal text-muted-foreground">({note})</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span>{count}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
        </span>
      </button>
      {open && (
        <div id={bodyId} className="border-t px-3">
          {hint && <p className="py-2 text-xs text-muted-foreground">{hint}</p>}
          <ul className="divide-y">{shown.map(render)}</ul>
          {!all && items.length > GROUP_PAGE && (
            <Button type="button" variant="outline" className="my-2 h-11 w-full sm:w-auto" onClick={() => setAll(true)}>
              {t("plan.showAll", { count: items.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Строка пункта плана: кто, что с ним станет, флажок «Исключить». memo: переключение флажка не перерисовывает всю группу. */
const PlanRow = memo(function PlanRow({
  item,
  editable,
  excluded,
  implied,
  onToggle,
  describe,
}: {
  item: PlanItem;
  editable: boolean;
  excluded: boolean;
  /** Перенос пропустится вместе с исключённой связью: флажок отмечен и недоступен. */
  implied: boolean;
  onToggle: (key: string) => void;
  describe: (part: ChangePart) => string;
}) {
  const t = useTranslations("kpiScreens.workly");
  const name = item.label || shortId(item.employee_id ?? `w${item.workly_id}`);
  const change = changeSummary(item).map(describe).join("; ");
  const off = excluded || implied;
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className={cn("text-sm font-medium break-words", off && "text-muted-foreground line-through")}>{name}</p>
        {change && <p className="text-xs text-muted-foreground break-words">{change}</p>}
        {editable && implied && <p className="text-xs text-amber-700">{t("plan.impliedSkip")}</p>}
      </div>
      {editable && (
        <label className={cn("flex min-h-11 shrink-0 items-center gap-2 text-sm", implied ? "cursor-not-allowed" : "cursor-pointer")}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={off}
            disabled={implied}
            aria-label={t("plan.excludeAria", { name })}
            onChange={() => onToggle(item.key)}
          />
          {t("plan.exclude")}
        </label>
      )}
    </li>
  );
});

/** Итог «Применить»: сколько применено и пропущенные пункты с причинами (пары move рядом). */
function ApplyResult({ result, byKey }: { result: WorklyApplyResult; byKey: ReadonlyMap<string, PlanItem> }) {
  const t = useTranslations("kpiScreens.workly");
  const groups = skippedGroups(result.skipped);
  const label = (s: SkippedItem) => {
    const it = byKey.get(s.key);
    const kind = (it?.kind ?? s.key.split(":")[0]) as PlanKind;
    return t("plan.result.skippedRow", {
      name: it?.label || s.key,
      kind: PLAN_GROUP_ORDER.includes(kind) ? t(`kinds.${kind}`) : kind,
      reason: t(`skipReasons.${s.reason}`),
    });
  };
  return (
    <div className="space-y-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
      <p role="status" className="font-medium">
        {t("plan.result.applied", { count: result.applied })}
      </p>
      {groups.length === 0 ? (
        <p>{t("plan.result.noSkipped")}</p>
      ) : (
        <div className="space-y-1">
          <p>{t("plan.result.skipped", { count: result.skipped.length })}</p>
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g[0]!.key} className={cn(g.length > 1 && "border-l-2 border-green-400 pl-2")}>
                {g.map((s) => (
                  <p key={s.key} className="break-words">
                    {label(s)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
