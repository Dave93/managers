"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Textarea } from "@components/ui/textarea";
import type { FieldDef, TicketPriority, TicketTypeRow } from "@admin/lib/tickets-api";
import {
  MAX_TEXT,
  buildDetails,
  describeFailure,
  lacksContractor,
  missingItems,
  pickBranch,
  setFieldValue,
  type Branch,
  type FieldValues,
} from "@admin/lib/tickets-create";

import { BranchPicker } from "./branch-picker";
import { DynamicFields, PillGroup } from "./dynamic-fields";
import { PhotoInput, revokePhoto, type PickedPhoto } from "./photo-input";
import { TypeBlockedNotice, TypeIcon, TypeTiles } from "./type-tiles";
import { useCreateTicket } from "./use-branch-tickets";

const NO_FIELDS: FieldDef[] = [];
const NO_FIELDS_MSG: string[] = [];

const PRIORITIES = [
  { value: "normal", label: "Обычная" },
  { value: "urgent", label: "Срочная" },
] as const satisfies readonly { value: TicketPriority; label: string }[];

// Две части экрана создания: плитки типов и форма выбранного типа. Данные
// (типы, филиалы) приходят снаружи уже загруженными, поэтому сюда не попасть
// без закреплённого филиала: страница не монтирует его иначе.
export function CreateFlow({
  types,
  branches,
  onCreated,
  onTypesStale,
  onAnother,
  initial,
}: {
  types: TicketTypeRow[];
  branches: Branch[];
  // Вызывается после успеха. Страница уходит в список; если права на него
  // нет, она сама покажет подтверждение.
  onCreated: (t: { id: string; number: string }) => void;
  // 404/422 от сервера: тип или схема изменились, список типов пора обновить.
  onTypesStale: () => void;
  // «Создать ещё одну» после успеха: страница пересоздаёт форму с нуля.
  onAnother: () => void;
  // Только для проверки отрисовки (SSR): стартовое состояние без нажатий.
  initial?: {
    typeId?: string;
    blockedId?: string;
    values?: FieldValues;
    priority?: TicketPriority;
    chosenBranchId?: string;
    photos?: PickedPhoto[];
    processing?: number;
    photoNotes?: string[];
    pending?: boolean;
    created?: { number: string };
  };
}) {
  const [typeId, setTypeId] = useState<string | null>(initial?.typeId ?? null);
  const [blockedId, setBlockedId] = useState<string | null>(initial?.blockedId ?? null);
  const [values, setValues] = useState<FieldValues>(initial?.values ?? {});
  const [priority, setPriority] = useState<TicketPriority>(initial?.priority ?? "normal");
  const [description, setDescription] = useState("");
  const [chosenBranch, setChosenBranch] = useState<string | null>(initial?.chosenBranchId ?? null);
  const [photos, setPhotos] = useState<PickedPhoto[]>(initial?.photos ?? []);
  const [processing, setProcessing] = useState(initial?.processing ?? 0);
  const create = useCreateTicket();

  // Превью — это blob:-адреса; при уходе со страницы их надо освободить. Через
  // ref: замыкание эффекта с пустыми зависимостями видело бы только первый,
  // пустой список.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach(revokePhoto), []);

  const selected = types.find((t) => t.id === typeId) ?? null;
  // Выбранный тип пропал из списка или потерял фирму, пока форма была открыта:
  // возвращаемся к плиткам и объясняем, а не даём заполнить заведомо
  // отвергаемую заявку.
  const typeGone = typeId !== null && selected === null;
  const formType = selected && !lacksContractor(selected) ? selected : null;
  const blocked = types.find((t) => t.id === blockedId) ?? (selected && lacksContractor(selected) ? selected : null);

  const pending = create.isPending || Boolean(initial?.pending);
  const done = create.isSuccess || Boolean(initial?.created);
  const createdNumber = create.created?.number ?? initial?.created?.number ?? null;
  const failure = create.error ? describeFailure(create.error) : null;

  const terminalId = pickBranch(branches, chosenBranch);
  const schema = formType?.fields_schema ?? NO_FIELDS;
  const missing = formType
    ? missingItems({
        schema,
        values,
        branchUnchosen: terminalId === null,
        photoCount: photos.length,
        photosProcessing: processing,
      })
    : NO_FIELDS_MSG;

  useEffect(() => {
    if (failure?.refetchTypes) onTypesStale();
    // Один раз на каждую новую ошибку.
  }, [create.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (t: TicketTypeRow) => {
    if (t.id !== typeId) setValues({});
    setTypeId(t.id);
    setBlockedId(null);
    create.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter в поле и нажатие по неактивной кнопке сюда доходят: проверяем ещё
    // раз. Защёлку от двойной отправки держит useCreateTicket.
    if (!formType || missing.length > 0 || pending || done) return;
    create.submit(
      {
        typeId: formType.id,
        terminalId,
        priority,
        details: buildDetails(formType.fields_schema, values),
        description,
        photos: photos.map((p) => p.file),
      },
      (t) => onCreated({ id: t.id, number: t.number })
    );
  };

  // -------- шаг 1: тип
  if (!formType) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Что случилось?</h2>
          <p className="text-base text-muted-foreground">Выберите тип заявки.</p>
        </div>
        {typeGone && (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-500/60 bg-amber-50 px-4 py-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-base leading-snug">
              Этот тип отключили, пока вы заполняли заявку. Выберите другой: фотографии останутся.
            </p>
          </div>
        )}
        {types.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-base text-muted-foreground">
            Типов заявок пока нет. Обратитесь к администратору: их заводят в разделе «Типы заявок».
          </p>
        ) : (
          <TypeTiles
            types={types}
            selectedId={typeId}
            blockedId={blocked?.id ?? null}
            onPick={pick}
            onBlocked={(t) => {
              setBlockedId(t.id);
              setTypeId(null);
            }}
          />
        )}
        {blocked && <TypeBlockedNotice type={blocked} />}
      </div>
    );
  }

  // -------- шаг 2: поля, приоритет, фото
  const label = pending
    ? "Отправляем заявку…"
    : done
      ? "Заявка создана"
      : processing > 0
        ? "Обрабатываем фото…"
        : "Создать заявку";
  const locked = pending || done;

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="h-11 px-4 text-base" disabled={locked} onClick={() => setTypeId(null)}>
          <ArrowLeft className="size-5" /> Другой тип
        </Button>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <TypeIcon name={formType.icon} className="size-6" /> {formType.name_ru}
          <span className="font-mono text-xs font-normal text-muted-foreground">{formType.code}</span>
        </div>
      </div>

      <fieldset disabled={locked} className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="space-y-5">
          <BranchPicker branches={branches} chosenId={chosenBranch} onChoose={setChosenBranch} disabled={locked} />
          <DynamicFields
            schema={schema}
            values={values}
            onChange={(key, value) => setValues((prev) => setFieldValue(prev, key, value))}
            disabled={locked}
          />
          <div className="space-y-2">
            <p id="priority-label" className="text-base font-medium">Срочность</p>
            <PillGroup
              labelledBy="priority-label"
              value={priority}
              options={PRIORITIES}
              onChange={(v) => setPriority(v ?? "normal")}
              disabled={locked}
            />
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="flex flex-wrap items-baseline gap-x-2 text-base font-medium">
              <span>Фотографии проблемы</span>
              <span className="text-sm font-normal text-muted-foreground">
                <span aria-hidden className="text-destructive">*</span> нужна хотя бы одна
              </span>
            </p>
            <PhotoInput
              photos={photos}
              onAdd={(added) => setPhotos((prev) => [...prev, ...added])}
              onRemove={(id) =>
                setPhotos((prev) => {
                  prev.filter((p) => p.id === id).forEach(revokePhoto);
                  return prev.filter((p) => p.id !== id);
                })
              }
              processing={processing}
              onProcessing={setProcessing}
              disabled={locked}
              initialNotes={initial?.photoNotes}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="ticket-description" className="flex flex-wrap items-baseline gap-x-2 text-base font-medium">
              <span>Комментарий</span>
              <span className="text-sm font-normal text-muted-foreground">по желанию</span>
            </label>
            <Textarea
              id="ticket-description"
              value={description}
              maxLength={MAX_TEXT}
              rows={3}
              placeholder="Что ещё нужно знать исполнителю"
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-24 text-base md:text-base"
            />
          </div>
        </div>
      </fieldset>

      <div className="space-y-3 border-t pt-4">
        {done && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-600/50 bg-emerald-50 px-4 py-3 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <p className="text-base font-medium">Заявка {createdNumber ?? ""} создана.</p>
            <Button type="button" variant="outline" className="h-11 px-4 text-base" onClick={onAnother}>
              Создать ещё одну
            </Button>
          </div>
        )}
        {failure && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-destructive">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-base leading-snug">{failure.message}</p>
          </div>
        )}
        <Button
          type="submit"
          className="h-14 w-full px-8 text-lg lg:w-auto lg:min-w-72"
          disabled={missing.length > 0 || locked}
        >
          {pending || processing > 0 ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
          {done ? <CheckCircle2 className="size-5" aria-hidden /> : null}
          {label}
        </Button>
        {missing.length > 0 && !locked && (
          <div className="text-sm text-muted-foreground">
            <p className="font-medium">Чтобы создать заявку:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {pending && (
          <p className="text-sm text-muted-foreground" role="status">
            Отправка фотографий может занять минуту. Не закрывайте экран и не нажимайте повторно.
          </p>
        )}
      </div>
    </form>
  );
}
