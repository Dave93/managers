"use client";
// Санитарная проверка с телефона: филиал, «да/нет» по пунктам шаблона, комментарий.
import React, { Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Label } from "@admin/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Textarea } from "@admin/components/ui/textarea";
import { Link, useRouter } from "@admin/i18n/routing";
import { kpiApi, type SanitaryTemplate, type ScopeRow } from "@admin/lib/kpi-api";
import { canOpen } from "@admin/lib/kpi/access";
import { KpiApiError, kpiErrorText, loadErrors, outcomeKnown, shouldRetry } from "@admin/lib/kpi/errors";
import { formatPct } from "@admin/lib/kpi/format";
import { calendarPeriod } from "@admin/lib/kpi/periods";
import { draftPct, emptySanitary, inspectableTerminals, sanitaryBody, sanitaryIssues } from "@admin/lib/kpi/sanitary";
import { createLatch } from "@admin/lib/kpi/violation-form";
import { cn } from "@admin/lib/utils";
import { ScreenGate } from "../../_components/screen-gate";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiMe, useKpiPerms, useKpiTerminals } from "../../_components/use-kpi";

const TRIGGER = "h-11 w-full data-[size=default]:h-11";
const COMMENT_MAX = 1000;
const TEMPLATE_CHANGED = "Пункты проверки изменились. Ответы сброшены: отметьте пункты заново";

export default function NewSanitaryPage() {
  return (
    <ScreenGate screen="sanitary">
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Загрузка…</p>}>
        <NewSanitaryScreen />
      </Suspense>
    </ScreenGate>
  );
}

function NewSanitaryScreen() {
  const me = useKpiMe({ refetchOnWindowFocus: false });
  const terminals = useKpiTerminals();
  const template = useQuery<SanitaryTemplate, Error>({
    queryKey: qk.sanitaryTemplate,
    queryFn: () => kpiApi.sanitary.template(),
    retry: shouldRetry,
    refetchOnWindowFocus: false,
  });
  const load = loadErrors(me, terminals, template);
  const stale = load.stale;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 pb-20 sm:p-6">
      <h1 className="text-xl font-semibold">Санитарная проверка</h1>

      {load.blocking == null && stale != null && <StaleNote error={stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking)}
        </p>
      ) : !me.data || !terminals.data || !template.data ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <SanitaryForm scopes={me.data.scopes} terminals={terminals.data} titles={template.data.items} refetchTemplate={() => template.refetch()} />
      )}
    </div>
  );
}

type Answers = { sig: string; list: (boolean | null)[] };

function SanitaryForm({
  scopes,
  terminals,
  titles,
  refetchTemplate,
}: {
  scopes: ScopeRow[];
  terminals: { id: string; name: string }[];
  titles: string[];
  refetchTemplate: () => Promise<unknown>;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { perms, access } = useKpiPerms();
  const params = useSearchParams();
  const list = useMemo(() => inspectableTerminals(scopes, terminals, access.manage), [scopes, terminals, access.manage]);

  const [pick, setPick] = useState<string | null>(null);
  const asked = params.get("terminal_id");
  const terminalId =
    pick ?? (asked && list.some((t) => t.id === asked) ? asked : list.length === 1 ? list[0].id : null);

  // Ответы привязаны к составу шаблона: если шаблон сменился, старые ответы не относятся к новым пунктам.
  const sig = titles.join("\n");
  const [stored, setStored] = useState<Answers | null>(null);
  const answers = stored && stored.sig === sig ? stored.list : emptySanitary(titles.length, null).answers;
  const [comment, setComment] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Исход запроса неизвестен (сеть, таймаут, 5xx): защёлка остаётся, повторная запись заблокирована.
  const [unknown, setUnknown] = useState(false);
  const [latch] = useState(createLatch);

  const draft = { terminal_id: terminalId, answers, comment };
  const pct = draftPct(draft);
  const marked = answers.filter((a) => a !== null).length;
  const locked = sending || unknown;
  const canBranch = canOpen(perms, "branch");

  const mark = (i: number, v: boolean) => {
    setIssues([]);
    setStored({ sig, list: answers.map((a, j) => (j === i ? v : a)) });
  };

  const submit = async () => {
    if (!latch.acquire()) return;
    const found = sanitaryIssues(draft, titles.length);
    setIssues(found);
    if (found.length > 0) {
      latch.release();
      return;
    }
    setSending(true);
    setNotice(null);
    let row;
    try {
      row = await kpiApi.sanitary.create(sanitaryBody(draft, titles));
    } catch (e) {
      if (outcomeKnown(e)) {
        if (e instanceof KpiApiError && e.code === "bad_items") {
          // Шаблон изменили, пока форма была открыта: берём новый и просим отметить заново.
          await refetchTemplate();
          setStored(null);
          setNotice(TEMPLATE_CHANGED);
        }
        toast.error(kpiErrorText(e));
        latch.release();
      } else {
        setUnknown(true);
      }
      setSending(false);
      return;
    }
    toast.success(`Проверка сохранена: ${formatPct(row.pct)}`);
    await Promise.all([qk.sanitaryAll, qk.branchAll].map((queryKey) => qc.invalidateQueries({ queryKey })));
    if (canBranch) {
      // Месяц берём из строки: проверка от 2 ноября лежит в ноябре, а страница без месяца откроет текущий период KPI.
      router.push(`/kpi/branch/${row.terminal_id}?period=${row.period}`);
      return;
    }
    setStored(null);
    setComment("");
    setIssues([]);
    latch.release();
    setSending(false);
  };

  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">Назначений на филиалы нет — попросите HR назначить вас проверяющим</p>;
  }

  const branchLink = terminalId ? `/kpi/branch/${terminalId}?period=${calendarPeriod(new Date())}` : "/kpi/network";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="s-terminal">Филиал</Label>
        <Select
          value={terminalId ?? ""}
          disabled={locked}
          onValueChange={(v) => {
            setPick(v);
            setIssues([]);
          }}
        >
          <SelectTrigger id="s-terminal" className={TRIGGER}>
            <SelectValue placeholder="Выберите филиал" />
          </SelectTrigger>
          <SelectContent>
            {list.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {notice && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {notice}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Отмечено {marked} из {titles.length}
          {pct !== null && ` · Выполнено ${formatPct(pct)}`}
        </p>
        <ul className="space-y-2">
          {titles.map((title, i) => (
            <li key={title} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium break-words">{title}</p>
              <div className="grid grid-cols-2 gap-2">
                <AnswerButton label="Да" tone="yes" pressed={answers[i] === true} disabled={locked} onClick={() => mark(i, true)} />
                <AnswerButton label="Нет" tone="no" pressed={answers[i] === false} disabled={locked} onClick={() => mark(i, false)} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="s-comment">Что не так</Label>
        <Textarea
          id="s-comment"
          rows={3}
          maxLength={COMMENT_MAX}
          value={comment}
          disabled={locked}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Необязательно"
        />
      </div>

      {issues.length > 0 && (
        <ul role="alert" className="list-inside list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {issues.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      {unknown && (
        <div role="alert" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Не знаем, дошла ли проверка до сервера. Проверьте список проверок филиала, прежде чем сохранять снова</p>
          {canBranch && (
            // Новая вкладка: ответы остаются, если проверка не дошла.
            <Link href={branchLink} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
              Открыть филиал
            </Link>
          )}
        </div>
      )}

      {/* Не sticky: нижняя панель ManagerLayout (h-16) закрыла бы кнопку. */}
      <Button type="submit" className="h-11 w-full" disabled={locked}>
        {sending ? "Сохраняем…" : "Сохранить проверку"}
      </Button>
    </form>
  );
}

function AnswerButton({
  label,
  tone,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  tone: "yes" | "no";
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-11 rounded-md border text-sm font-medium transition-colors disabled:opacity-50",
        pressed
          ? tone === "yes"
            ? "border-green-600 bg-green-600 text-white"
            : "border-red-600 bg-red-600 text-white"
          : "bg-background hover:bg-muted/50"
      )}
    >
      {label}
    </button>
  );
}
