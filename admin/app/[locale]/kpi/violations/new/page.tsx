"use client";
// Запись нарушения с телефона. Время не выбирается: сервер ставит текущее, свой выбор принёс бы ошибки часового пояса.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Label } from "@admin/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Textarea } from "@admin/components/ui/textarea";
import { Link, useRouter } from "@admin/i18n/routing";
import { kpiApi, postViolation } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, outcomeKnown, shouldRetry } from "@admin/lib/kpi/errors";
import { employeeName } from "@admin/lib/kpi/filters";
import { calendarPeriod } from "@admin/lib/kpi/periods";
import {
  KPI_MAX_PHOTOS,
  VIOLATION_COMMENT_MIN,
  buildViolationFormData,
  createLatch,
  evaluableEmployees,
  evaluableTerminals,
  itemsForCard,
  violationIssues,
} from "@admin/lib/kpi/violation-form";
import { PhotoInput, revokePhoto, type PickedPhoto } from "../../_components/photo-input";
import { ScreenGate } from "../../_components/screen-gate";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiMe } from "../../_components/use-kpi";

const NO_ITEM = "__none__";
const TRIGGER = "h-11 w-full data-[size=default]:h-11";

export default function NewViolationPage() {
  return (
    <ScreenGate screen="violations" require="kpi.evaluate">
      <NewViolationScreen />
    </ScreenGate>
  );
}

function NewViolationScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  // Пока заполняют форму, возврат на вкладку не перезапрашивает данные: сбой обновления не должен её трогать.
  const me = useKpiMe({ refetchOnWindowFocus: false });
  const period = useMemo(() => calendarPeriod(new Date()), []);

  const employees = useQuery({
    queryKey: qk.employees({ period }),
    queryFn: () => kpiApi.employees.list({ period }),
    retry: shouldRetry,
    refetchOnWindowFocus: false,
  });
  const cards = useQuery({
    queryKey: qk.cards(false),
    queryFn: () => kpiApi.cards.list(),
    retry: shouldRetry,
    refetchOnWindowFocus: false,
  });

  const [terminalPick, setTerminalPick] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [processing, setProcessing] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  // Исход запроса неизвестен (сеть, таймаут, 5xx): защёлка остаётся, повторная запись заблокирована.
  const [unknown, setUnknown] = useState(false);
  const [latch] = useState(createLatch);

  // Освобождаем blob-адреса при уходе с экрана; revokePhoto повторно безопасен.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach(revokePhoto), []);

  const rows = useMemo(() => employees.data ?? [], [employees.data]);
  const terminals = useMemo(() => evaluableTerminals(rows), [rows]);
  const terminalId = terminalPick ?? (terminals.length === 1 ? terminals[0].id : null);
  const people = useMemo(() => evaluableEmployees(rows, terminalId), [rows, terminalId]);
  const row = useMemo(() => people.find((r) => r.id === employeeId) ?? null, [people, employeeId]);
  const items = useMemo(() => itemsForCard(cards.data ?? [], row?.card?.id ?? null), [cards.data, row]);

  const photoRequired = me.data?.settings.violation_photo_required ?? false;
  const locked = sending || unknown;

  const submit = async () => {
    if (!latch.acquire()) return;
    const draft = { terminal_id: terminalId, employee_id: employeeId, card_item_id: itemId, comment, photos: photos.map((p) => p.file) };
    const found = violationIssues(draft, photoRequired);
    setIssues(found);
    if (found.length > 0) {
      latch.release();
      return;
    }
    setSending(true);
    try {
      await postViolation(buildViolationFormData(draft));
    } catch (e) {
      if (outcomeKnown(e)) {
        latch.release();
        toast.error(kpiErrorText(e));
      } else {
        setUnknown(true);
      }
      setSending(false);
      return;
    }
    // Нарушение записано: защёлка остаётся до ухода с экрана, повторной записи быть не должно.
    toast.success("Нарушение записано");
    photos.forEach(revokePhoto);
    await Promise.all([qk.violationsAll, qk.formAll].map((queryKey) => qc.invalidateQueries({ queryKey })));
    router.push("/kpi/violations");
  };

  // Ошибка закрывает форму, только пока данных нет. Карты не блокируют: без них можно записать «Без пункта».
  const load = loadErrors(employees, me);
  const stale = load.stale ?? loadErrors(cards).stale;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 pb-20 sm:p-6">
      <h1 className="text-xl font-semibold">Зафиксировать нарушение</h1>

      {load.blocking == null && stale != null && <StaleNote error={stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking)}
        </p>
      ) : employees.isPending || me.isPending ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : terminals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет сотрудников, которых вы можете оценивать. Попросите HR назначить вас оценщиком.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="v-terminal">Филиал</Label>
            <Select
              value={terminalId ?? ""}
              disabled={locked}
              onValueChange={(v) => {
                setTerminalPick(v);
                setEmployeeId(null);
                setItemId(null);
              }}
            >
              <SelectTrigger id="v-terminal" className={TRIGGER}>
                <SelectValue placeholder="Выберите филиал" />
              </SelectTrigger>
              <SelectContent>
                {terminals.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-employee">Сотрудник</Label>
            <Select
              value={employeeId ?? ""}
              disabled={locked || !terminalId}
              onValueChange={(v) => {
                setEmployeeId(v);
                setItemId(null);
              }}
            >
              <SelectTrigger id="v-employee" className={TRIGGER}>
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {people.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {employeeName(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-item">Пункт карты</Label>
            <Select
              value={itemId ?? NO_ITEM}
              disabled={locked || !row}
              onValueChange={(v) => setItemId(v === NO_ITEM ? null : v)}
            >
              <SelectTrigger id="v-item" className={TRIGGER}>
                <SelectValue placeholder="Без пункта" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ITEM}>Без пункта</SelectItem>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.title_ru}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cards.data === undefined && cards.error != null ? (
              <p role="alert" className="text-xs text-destructive">
                Пункты карты не загрузились: {kpiErrorText(cards.error)}. Можно записать без пункта
              </p>
            ) : (
              row && cards.isPending && <p className="text-xs text-muted-foreground">Загрузка пунктов…</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-comment">Что случилось</Label>
            <Textarea
              id="v-comment"
              rows={4}
              value={comment}
              disabled={locked}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что случилось"
            />
            <p className="text-xs text-muted-foreground">Не меньше {VIOLATION_COMMENT_MIN} символов</p>
            <p className="text-xs text-muted-foreground">Комментарий увидит сотрудник</p>
          </div>

          <div className="space-y-1.5">
            <Label>{photoRequired ? "Фото (обязательно)" : "Фото"}</Label>
            <PhotoInput
              photos={photos}
              max={KPI_MAX_PHOTOS}
              processing={processing}
              onBusy={(d) => setProcessing((n) => n + d)}
              onAdd={(a) => setPhotos((cur) => [...cur, ...a])}
              onRemove={(id) =>
                setPhotos((cur) => {
                  cur.filter((p) => p.id === id).forEach(revokePhoto);
                  return cur.filter((p) => p.id !== id);
                })
              }
              disabled={locked}
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
              <p>Не знаем, дошло ли нарушение до сервера. Откройте журнал и проверьте, прежде чем записывать снова</p>
              {/* Новая вкладка: форма с фото остаётся, если нарушение не дошло. */}
              <Link href="/kpi/violations" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                Открыть журнал
              </Link>
            </div>
          )}

          {/* Не sticky: нижняя панель ManagerLayout (h-16) закрыла бы кнопку. */}
          <Button type="submit" className="h-11 w-full" disabled={processing > 0 || locked}>
            Зафиксировать
          </Button>
        </form>
      )}
    </div>
  );
}
