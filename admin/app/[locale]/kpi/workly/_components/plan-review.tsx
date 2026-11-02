"use client";
// Сверка сотрудников по одному прогону: счётчики «в плане», группы пунктов (свёрнуты, по 50 строк),
// исключения, блоки отчёта с ручной связью и «Применить» с подтверждением.
// Один компонент на прогон (key = run.id) и для planned, и для applied: ответ «Применить»
// показывается сразу и не теряется, когда прогон перечитывается уже как applied. Пока видны флажки,
// зачёркнуты исключённые строки; у применённого плана — только пропущенные бэкендом (planRowMark).

import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { KpiApiError } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { PLAN_GROUP_ORDER, canApply, groupPlan, toggleExclusion } from "@admin/lib/kpi/workly";
import {
  GROUP_PAGE,
  SKIPPED_PAGE,
  appliedSkips,
  applyPreview,
  changeSummary,
  isNamelessRecord,
  linkSeed,
  planRowMark,
  searchSeed,
  shortId,
  skippedGroups,
  visibleItems,
  type ChangePart,
  type RowMark,
  type SkipReason,
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
  const countersId = useId();
  const excludeHintId = useId();

  const plan = run.plan;
  const items = useMemo(() => plan?.items ?? [], [plan]);
  const report = plan?.report;

  // Исключённые ключи живут, пока открыт этот прогон (новый прогон — новый key компонента).
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(NO_EXCLUSIONS);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<WorklyApplyResult | null>(null);
  const [applyError, setApplyError] = useState<unknown>(null);
  // Сотрудники, связанные вручную из строк отчёта: план это не обновляет до нового «Проверить».
  const [linked, setLinked] = useState<ReadonlySet<string>>(NO_EXCLUSIONS);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  // Сервер ответил, что план больше не применить (409 run_superseded / run_not_planned):
  // «Применить» гаснет, остаётся «Проверить заново».
  const [superseded, setSuperseded] = useState(false);
  const latch = useRef(false);

  // Флажки и «Применить» есть у спланированного прогона, пока его не применили и сервер его не отверг.
  const showControls = canApply(run) && result == null && !superseded;
  // Пока запускается новая проверка, они видны, но недоступны.
  const editable = showControls && !rechecking;

  const activeExcluded = showControls ? excluded : NO_EXCLUSIONS;
  // Что уйдёт в применение: без исключённых и без переносов, которые бэкенд пропустит
  // вместе с исключённой связью. В apply уходит только то, что исключил человек.
  const preview = useMemo(() => applyPreview(items, activeExcluded), [items, activeExcluded]);
  const implied: ReadonlySet<string> = preview.implied;
  const counts = preview.counts;
  const groups = useMemo(() => groupPlan(items), [items]);
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
      if (e instanceof KpiApiError && (e.code === "run_superseded" || e.code === "run_not_planned")) setSuperseded(true);
      setConfirmOpen(false);
      refresh();
    },
    onSettled: () => {
      latch.current = false;
    },
  });

  const submit = () => {
    if (latch.current || !editable || preview.total === 0) return;
    latch.current = true;
    apply.mutate();
  };

  // Прогон перестал быть применимым, пока окно подтверждения открыто (перечитан как applied,
  // вытеснен, запускается новая проверка): окно закрывается, чтобы не показывать устаревшие числа.
  // Пока идёт свой запрос «Применить», окно закроет его ответ.
  if (confirmOpen && !editable && !apply.isPending) setConfirmOpen(false);

  // Итог: ответ «Применить» сразу, после перечитывания — из plan.applied / plan.skipped.
  const shownResult: WorklyApplyResult | null =
    result ?? (run.status === "applied" && plan?.applied ? { applied: plan.applied.length, skipped: plan.skipped ?? [] } : null);
  // Пропущенные при применении пункты: у применённого (и откатанного) плана строки помечаются по ним.
  const skippedMap = useMemo(() => appliedSkips(plan, result), [plan, result]);
  const markView = useMemo(
    () => ({ controls: showControls, excluded: activeExcluded, implied, skipped: skippedMap }),
    [showControls, activeExcluded, implied, skippedMap]
  );
  const builtAt = t("plan.builtAt", { time: formatTashkent(run.created_at) });

  const describe = useCallback(
    (part: ChangePart): string => {
      switch (part.type) {
        case "deactivate":
          return t("plan.change.deactivate");
        case "deactivateByName":
          return t("plan.change.deactivateByName", { id: String(part.workly_id) });
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
        // Счётчики — пункты плана (без исключённых, пока видны флажки), а не итог применения:
        // итог показывает блок ниже.
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span id={countersId} className="text-muted-foreground">
            {t("plan.inPlan")}
          </span>
          <ul aria-labelledby={countersId} className="flex flex-wrap gap-2">
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
        </div>
      )}

      {/* Фокус переходит на итог только после «Применить» в этом сеансе, а не при открытии итога. */}
      {shownResult && <ApplyResult result={shownResult} byKey={byKey} autoFocus={result != null} />}

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
          {/* Одна подсказка на весь план: на неё ссылается каждый флажок «Исключить» (R36). */}
          {showControls && (
            <p id={excludeHintId} className="text-xs text-muted-foreground">
              {t("plan.excludeHint")}
            </p>
          )}
          {groups.map((g) => {
            const off = countStruck(g.items, markView);
            const note = off === 0 ? null : showControls ? t("plan.excludedCount", { count: off }) : t("plan.skippedCount", { count: off });
            return (
              <Group
                key={g.kind}
                title={t(`kinds.${g.kind}`)}
                count={g.items.length}
                note={note}
                items={g.items}
                render={(it) => {
                  const mark = planRowMark(it.key, markView);
                  return (
                    <PlanRow
                      key={it.key}
                      item={it}
                      editable={showControls}
                      locked={!editable}
                      struck={mark.struck}
                      note={mark.note}
                      hintId={excludeHintId}
                      onToggle={onToggle}
                      describe={describe}
                    />
                  );
                }}
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
              render={(r) => {
                // Ограничение отчёта: у неоднозначной строки есть только подпись (имя записи Workly)
                // и id наших кандидатов, имён наших сотрудников в ней нет. Поэтому кнопка каждого
                // кандидата подписана общей подписью и коротким хвостом его id. Подпись записи без
                // имени бэкенд пишет по-русски: вместо неё — «Запись Workly № N» на языке экрана.
                const nameless = isNamelessRecord(r);
                return (
                  <li key={`${r.workly_id}`} className="space-y-2 py-2">
                    <p className="text-sm font-medium break-words">
                      {nameless ? t("report.worklyRecord", { id: String(r.workly_id) }) : r.label}
                    </p>
                    {nameless ? (
                      <p className="text-xs text-muted-foreground">{t("report.nameless")}</p>
                    ) : r.employee_ids.length === 0 ? (
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
                              onClick={() => setLinkTarget({ id, label: r.label, seed: linkSeed(r), kind: "ambiguous" })}
                            >
                              {t("report.linkCandidate", { id: shortId(id) })}
                            </Button>
                          )
                        )}
                      </div>
                    )}
                  </li>
                );
              }}
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
                      onClick={() => setLinkTarget({ id: r.employee_id, label: r.label, seed: searchSeed(r.label), kind: "not_found" })}
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

      {showControls && (
        <div className="space-y-2 border-t pt-4">
          {preview.total === 0 && (
            <p className="text-sm text-muted-foreground">{items.length === 0 ? t("plan.nothingToApply") : t("plan.allExcluded")}</p>
          )}
          <Button
            type="button"
            className="h-11 w-full sm:w-auto"
            disabled={!editable || preview.total === 0 || apply.isPending}
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
          <p className="text-sm text-muted-foreground">{builtAt}</p>
          <ul className="space-y-1 text-sm">
            {preview.lines.map((l) => (
              <li key={l.kind}>{t("plan.counter", { kind: t(`kinds.${l.kind}`), count: l.count })}</li>
            ))}
          </ul>
          {preview.deactivate > 0 && (
            <p className="rounded-md border-2 border-destructive p-3 text-sm font-semibold text-destructive">
              {t("confirm.deactivate", { count: preview.deactivate })}
            </p>
          )}
          {preview.excluded > 0 && <p className="text-sm">{t("confirm.excluded", { count: preview.excluded })}</p>}
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
              disabled={!editable || apply.isPending || preview.total === 0}
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

/**
 * Сколько строк группы зачёркнуто: пока видны флажки — исключённые и переносы, пропущенные вместе
 * со связью; у применённого плана — пропущенные при применении.
 */
function countStruck(items: PlanItem[], view: Parameters<typeof planRowMark>[1]): number {
  let n = 0;
  for (const it of items) if (planRowMark(it.key, view).struck) n++;
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
        // Тело группы рендерится только раскрытым: ссылка на него — только тогда.
        aria-controls={open ? bodyId : undefined}
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
  locked,
  struck,
  note,
  hintId,
  onToggle,
  describe,
}: {
  item: PlanItem;
  /** Показывать флажок: план ещё можно применить. */
  editable: boolean;
  /** Флажок виден, но недоступен (запускается новая проверка). */
  locked: boolean;
  /** Строка не уйдёт или не ушла в применение (planRowMark). */
  struck: boolean;
  /** implied — перенос пропустится вместе с исключённой связью (флажок отмечен и недоступен); иначе причина пропуска при применении. */
  note: RowMark["note"];
  /** id подсказки об исключении: на неё ссылается флажок. */
  hintId: string;
  onToggle: (key: string) => void;
  describe: (part: ChangePart) => string;
}) {
  const t = useTranslations("kpiScreens.workly");
  const name = item.label || shortId(item.employee_id ?? `w${item.workly_id}`);
  const change = changeSummary(item).map(describe).join("; ");
  const implied = note === "implied";
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className={cn("text-sm font-medium break-words", struck && "text-muted-foreground line-through")}>{name}</p>
        {change && <p className="text-xs text-muted-foreground break-words">{change}</p>}
        {implied && <p className="text-xs text-amber-700">{t("plan.impliedSkip")}</p>}
        {note != null && !implied && <p className="text-xs text-muted-foreground">{t(`skipReasons.${note satisfies SkipReason}`)}</p>}
      </div>
      {editable && (
        <label
          className={cn("flex min-h-11 shrink-0 items-center gap-2 text-sm", implied || locked ? "cursor-not-allowed" : "cursor-pointer")}
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={struck}
            disabled={implied || locked}
            aria-label={t("plan.excludeAria", { name })}
            aria-describedby={hintId}
            onChange={() => onToggle(item.key)}
          />
          {t("plan.exclude")}
        </label>
      )}
    </li>
  );
});

/**
 * Итог «Применить»: сколько применено и пропущенные пункты с причинами (пары move рядом).
 * autoFocus — итог только что пришёл ответом «Применить»: фокус переходит на блок один раз,
 * и экранный диктор читает его (кнопка «Применить» к этому моменту уже исчезла).
 */
function ApplyResult({
  result,
  byKey,
  autoFocus,
}: {
  result: WorklyApplyResult;
  byKey: ReadonlyMap<string, PlanItem>;
  autoFocus: boolean;
}) {
  const t = useTranslations("kpiScreens.workly");
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!autoFocus || focused.current) return;
    focused.current = true;
    box.current?.focus();
  }, [autoFocus]);
  const groups = skippedGroups(result.skipped);
  // Строка списка — группа (пара move рядом со связью); видно первые SKIPPED_PAGE строк.
  const shown = visibleItems(groups, all, SKIPPED_PAGE);
  const label = (s: SkippedItem) => {
    const it = byKey.get(s.key);
    const kind = (it?.kind ?? s.key.split(":")[0]) as PlanKind;
    // Без подписи — короткий хвост id из ключа (`move:<uuid>` → «…6789ab»), а не весь ключ.
    const id = s.key.slice(s.key.indexOf(":") + 1);
    return t("plan.result.skippedRow", {
      name: it?.label || shortId(id),
      kind: PLAN_GROUP_ORDER.includes(kind) ? t(`kinds.${kind}`) : kind,
      reason: t(`skipReasons.${s.reason}`),
    });
  };
  return (
    <div
      ref={box}
      role="status"
      tabIndex={-1}
      className="space-y-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="font-medium">{t("plan.result.applied", { count: result.applied })}</p>
      {groups.length === 0 ? (
        <p>{t("plan.result.noSkipped")}</p>
      ) : (
        <div className="space-y-1">
          <p>{t("plan.result.skipped", { count: result.skipped.length })}</p>
          <ul className="space-y-1">
            {shown.map((g) => (
              <li key={g[0]!.key} className={cn(g.length > 1 && "border-l-2 border-green-400 pl-2")}>
                {g.map((s) => (
                  <p key={s.key} className="break-words">
                    {label(s)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {!all && groups.length > SKIPPED_PAGE && (
            <Button type="button" variant="outline" className="h-11 w-full bg-background sm:w-auto" onClick={() => setAll(true)}>
              {t("plan.showAll", { count: result.skipped.length })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
