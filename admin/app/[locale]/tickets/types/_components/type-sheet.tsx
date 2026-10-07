"use client";

// Панель типа заявки: создание и правка. Тело панели держит черновик, а ключ
// «эпоха» из useSheetSession пересоздаёт его при каждом новом открытии, так
// что закрытая и открытая снова панель не помнит прошлых правок и ошибок.
//
// Что PUT /ticket_types/:id принимает, а что нет:
//  * code и executor_kind после создания не меняются: в правке они только
//    текстом, а не полем, которое молча не отправится;
//  * contractor_id нельзя стереть (пустая строка не UUID, null тело не
//    принимает), поэтому, когда фирма уже выбрана, пункта «не выбрана» нет;
//  * у типа staff фирмы нет вовсе, сервер отвечает 422, и поля тоже нет.
// Отправляются только изменённые поля, а fields_schema — только если схема
// действительно изменилась: нетронутая схема не переписывается.
//
// Тип с executor_kind = "external" и без фирмы — законное состояние «фирму ещё
// не выбрали»: оба типа из сида такие. Панель его не запрещает, а подписывает.

import { useId, useMemo, useRef, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Switch } from "@components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import type { ContractorRow, TicketTypeRow } from "@admin/lib/tickets-api";

import { useSheetSession } from "../../contractors/_components/use-contractors";
import { FieldsEditor, Segmented } from "./fields-editor";
import {
  buildCreateBody,
  buildUpdatePatch,
  noRisks,
  orphanRisks,
  schemaSignature,
  toDrafts,
  validateDrafts,
  validateTypeForm,
  type FormState,
  type OrphanRisks,
  type TypeFormValues,
} from "./rules";
import {
  CONTRACTORS_RIGHT,
  LIST_RIGHT,
  TYPES_RIGHT,
  serverProblem,
  useTypeActions,
  useTypeTicketCount,
} from "./use-types";

export type TypeTarget = { kind: "create" } | { kind: "edit"; id: string };

// Что панель знает о справочнике фирм. denied — 403: у роли, управляющей
// типами, может не быть права на фирмы, и тогда название фирмы и её выбор
// недоступны, но остальной тип править можно.
export type FirmsState =
  | { status: "loading" }
  | { status: "ready"; list: ContractorRow[] }
  | { status: "denied" }
  | { status: "error"; message: string };

const NO_FIRM = "__none__";

const FORM_LABELS: Record<keyof TypeFormValues, string> = {
  code: "Код",
  number_prefix: "Префикс номера",
  name_ru: "Название по-русски",
  name_uz: "Название по-узбекски",
  icon: "Значок",
  sort: "Порядок на планшете",
};

const KINDS = [
  { value: "external", label: "Внешняя фирма" },
  { value: "staff", label: "Сотрудник" },
] as const;

export function TypeSheet({
  target,
  rows,
  firms,
  onRetryFirms,
  onClose,
}: {
  target: TypeTarget | null;
  rows: TicketTypeRow[];
  firms: FirmsState;
  onRetryFirms: () => void;
  onClose: () => void;
}) {
  const { shown, epoch } = useSheetSession(target);
  const row = shown?.kind === "edit" ? (rows.find((r) => r.id === shown.id) ?? null) : null;

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
        {shown !== null && (
          <TypeBody
            key={`${shown.kind === "edit" ? shown.id : "new"}:${epoch}`}
            mode={shown.kind}
            row={row}
            firms={firms}
            onRetryFirms={onRetryFirms}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function CountNote({
  count,
}: {
  count: { state: "known"; n: number } | { state: "unknown" } | { state: "checking" };
}) {
  if (count.state === "known") {
    return <>По этому типу уже есть заявки: {count.n}.</>;
  }
  if (count.state === "checking") {
    return <>Идёт проверка, есть ли заявки по этому типу. Считайте, что есть.</>;
  }
  return (
    <>
      Не удалось проверить, есть ли заявки по этому типу (для проверки нужно право{" "}
      <code className="font-mono text-[12px]">{LIST_RIGHT}</code>). Считайте, что есть.
    </>
  );
}

export function RiskList({ risks }: { risks: OrphanRisks }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
      {risks.renamed.map((r) => (
        <li key={`rn:${r.from}`}>
          Ключ «{r.from}» заменён на «{r.to}»: в старых заявках значение остаётся под «{r.from}»,
          карточка покажет его без подписи с пометкой «поле удалено из типа».
        </li>
      ))}
      {risks.removed.map((k) => (
        <li key={`rm:${k}`}>
          Поле «{k}» удалено: в старых заявках значение останется, но без подписи и с пометкой
          «поле удалено из типа».
        </li>
      ))}
      {risks.optionLoss.map((o) => (
        <li key={`op:${o.key}`}>
          {o.toText
            ? `Поле «${o.key}» стало текстовым: в старых заявках вместо подписи варианта будет показан его код.`
            : `Поле «${o.key}»: варианты ${o.values.map((v) => `«${v}»`).join(", ")} убраны или переименованы, в старых заявках вместо подписи будет показан код значения.`}
        </li>
      ))}
    </ul>
  );
}

export function TypeBody({
  mode,
  row,
  firms,
  onRetryFirms,
  onClose,
}: {
  mode: "create" | "edit";
  row: TicketTypeRow | null;
  firms: FirmsState;
  onRetryFirms: () => void;
  onClose: () => void;
}) {
  const ids = {
    code: useId(),
    prefix: useId(),
    nameRu: useId(),
    nameUz: useId(),
    icon: useId(),
    sort: useId(),
    kind: useId(),
    firm: useId(),
    active: useId(),
  };
  const actions = useTypeActions();
  const mutation = mode === "create" ? actions.create : actions.update;
  const pending = mutation.isPending;
  const error = mutation.error;

  // Снимок на момент открытия: сравнение «что изменилось» и «что осиротеет»
  // идёт с тем, что человек увидел, а не с тем, что прилетело при фоновом
  // обновлении списка.
  const [initial] = useState(() => {
    const fields = toDrafts(row?.fields_schema ?? []);
    const state: FormState = {
      values: {
        code: row?.code ?? "",
        number_prefix: row?.number_prefix ?? "",
        name_ru: row?.name_ru ?? "",
        name_uz: row?.name_uz ?? "",
        icon: row?.icon ?? "",
        sort: String(row?.sort ?? 0),
      },
      kind: row?.executor_kind ?? "external",
      contractorId: row?.contractor_id ?? "",
      active: row?.active ?? true,
      fields,
    };
    return {
      state,
      byUid: new Map(fields.map((f) => [f.uid, f])),
      signature: schemaSignature(fields),
    };
  });

  const [values, setValues] = useState<TypeFormValues>(initial.state.values);
  const [touched, setTouched] = useState<Partial<Record<keyof TypeFormValues, boolean>>>({});
  const [kind, setKind] = useState(initial.state.kind);
  const [contractorId, setContractorId] = useState(initial.state.contractorId);
  const [active, setActive] = useState(initial.state.active);
  const [fields, setFields] = useState(initial.state.fields);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const count = useTypeTicketCount(mode === "edit" && row ? row.id : null);

  // Сервер отвечает 422 по схеме списком; блок стоит над формой, и при новом
  // ответе панель прокручивается к нему: кнопка «Сохранить» в подвале, а форма
  // может быть прокручена вниз, к полям.
  const problemRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error) problemRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const setValue = (k: keyof TypeFormValues, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setTouched((prev) => ({ ...prev, [k]: true }));
  };

  const formErrors = validateTypeForm(values, mode, initial.state.values);
  const issues = useMemo(() => validateDrafts(fields), [fields]);
  const schemaChanged = schemaSignature(fields) !== initial.signature;
  // Сохранённая схема, которую не трогали, на запись не уходит, так что её
  // проблемы не должны мешать, например, выключить тип. Новая и изменённая
  // схема блокируют сохранение, пока в ней есть хоть одна ошибка.
  const blocking = mode === "create" || schemaChanged ? issues : [];

  const now: FormState = { values, kind, contractorId, active, fields };
  const patch = buildUpdatePatch(initial.state, now);
  const dirty = Object.keys(patch).length > 0;

  const firstFormError = (Object.entries(formErrors) as [keyof TypeFormValues, string][])[0];
  const hasFormErrors = firstFormError !== undefined;
  const canSave =
    !pending && !hasFormErrors && blocking.length === 0 && (mode === "create" || dirty);

  const risks = orphanRisks(initial.state.fields, fields);
  const countState: React.ComponentProps<typeof CountNote>["count"] =
    count.data !== undefined
      ? { state: "known", n: count.data }
      : count.isError
        ? { state: "unknown" }
        : { state: "checking" };
  // Предупреждение пропускается только при точном нуле. Всё остальное,
  // включая «ещё проверяем» и отказ в праве, предупреждает.
  const needsConfirm = mode === "edit" && !noRisks(risks) && count.data !== 0;

  const save = () => {
    if (mode === "create") {
      actions.create.mutate(buildCreateBody(now), { onSuccess: onClose });
    } else if (row && dirty) {
      actions.update.mutate({ id: row.id, body: patch }, { onSuccess: onClose });
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (needsConfirm) {
      setConfirmOpen(true);
      return;
    }
    save();
  };

  if (mode === "edit" && row === null) {
    return (
      <>
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <SheetTitle className="text-base">Тип заявки</SheetTitle>
          <SheetDescription className="sr-only">Правка типа заявки</SheetDescription>
        </SheetHeader>
        <div role="alert" className="flex items-start gap-3 px-5 py-6">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[12.5px] leading-snug text-muted-foreground">
            Тип не найден в загруженном списке. Закройте панель и обновите страницу.
          </p>
        </div>
      </>
    );
  }

  const shownError = (k: keyof TypeFormValues) =>
    touched[k] || mode === "edit" ? formErrors[k] : undefined;
  const problem = error ? serverProblem(error) : null;

  const firmList = firms.status === "ready" ? firms.list : [];
  const boundFirm = initial.state.contractorId
    ? (firmList.find((f) => f.id === initial.state.contractorId) ?? null)
    : null;
  // Пока фирма не выбрана ни в базе, ни в форме, тип нельзя использовать.
  const noFirmChosen = kind === "external" && contractorId === "";

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
        <SheetTitle className="text-base">
          {mode === "create" ? "Новый тип заявки" : initial.state.values.name_ru || "Тип заявки"}
        </SheetTitle>
        <SheetDescription className="text-[12px]">
          {mode === "create"
            ? "Название, фирма и поля, которые менеджер заполняет на планшете."
            : "Название, фирма и поля типа. Код и вид исполнителя после создания не меняются."}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {problem && (
          <div
            ref={problemRef}
            role="alert"
            className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5"
          >
            <p className="break-words text-[13px] font-medium leading-snug text-destructive">
              {problem.headline}
            </p>
            {problem.items.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] leading-snug text-destructive">
                {problem.items.map((m, i) => (
                  <li key={i} className="break-words">
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <section aria-label="Основное" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.nameRu}>Название по-русски</Label>
              <Input
                id={ids.nameRu}
                value={values.name_ru}
                onChange={(e) => setValue("name_ru", e.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, name_ru: true }))}
                aria-invalid={Boolean(shownError("name_ru"))}
                autoComplete="off"
                disabled={pending}
              />
              {shownError("name_ru") && (
                <p className="text-[12px] text-destructive">{shownError("name_ru")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.nameUz}>Название по-узбекски</Label>
              <Input
                id={ids.nameUz}
                value={values.name_uz}
                onChange={(e) => setValue("name_uz", e.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, name_uz: true }))}
                aria-invalid={Boolean(shownError("name_uz"))}
                autoComplete="off"
                disabled={pending}
              />
              {shownError("name_uz") && (
                <p className="text-[12px] text-destructive">{shownError("name_uz")}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.code}>Код</Label>
              {mode === "create" ? (
                <>
                  <Input
                    id={ids.code}
                    value={values.code}
                    onChange={(e) => setValue("code", e.target.value)}
                    onBlur={() => setTouched((p) => ({ ...p, code: true }))}
                    aria-invalid={Boolean(shownError("code"))}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="например, ad_tv"
                    className="font-mono text-[13px]"
                    disabled={pending}
                  />
                  {shownError("code") ? (
                    <p className="text-[12px] text-destructive">{shownError("code")}</p>
                  ) : (
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      Уникален. После создания не меняется.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p
                    id={ids.code}
                    className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-[13px]"
                  >
                    {initial.state.values.code}
                  </p>
                  <p className="text-[12px] leading-snug text-muted-foreground">
                    Не меняется после создания.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.prefix}>Префикс номера</Label>
              <Input
                id={ids.prefix}
                value={values.number_prefix}
                onChange={(e) => setValue("number_prefix", e.target.value.toUpperCase())}
                onBlur={() => setTouched((p) => ({ ...p, number_prefix: true }))}
                aria-invalid={Boolean(shownError("number_prefix"))}
                autoComplete="off"
                spellCheck={false}
                placeholder="например, TV"
                className="font-mono text-[13px]"
                disabled={pending}
              />
              {shownError("number_prefix") && (
                <p className="text-[12px] text-destructive">{shownError("number_prefix")}</p>
              )}
              <p className="text-[12px] leading-snug text-muted-foreground">
                Номер заявки собирается как «{values.number_prefix.trim() || "TV"}-000123». Если сменить
                префикс у типа, по которому заявки уже есть, старые останутся со старым префиксом, а
                новые получат новый: у одного типа будут два вида номеров.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label id={ids.kind}>Исполнитель</Label>
            {mode === "create" ? (
              <div>
                <Segmented
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    // Фирма имеет смысл только у внешнего исполнителя; у staff
                    // сервер на неё отвечает 422.
                    if (k === "staff") setContractorId("");
                  }}
                  options={KINDS}
                  disabled={pending}
                  labelledBy={ids.kind}
                />
              </div>
            ) : (
              <p className="text-[13px]">
                {initial.state.kind === "external" ? "Внешняя фирма" : "Сотрудник"}
                <span className="ml-2 text-[12px] text-muted-foreground">
                  Не меняется после создания.
                </span>
              </p>
            )}
          </div>

          {kind === "staff" ? (
            <p className="text-[12px] leading-snug text-muted-foreground">
              Заявки этого типа берёт сотрудник, фирма не нужна.
            </p>
          ) : (
            <FirmControl
              id={ids.firm}
              firms={firms}
              onRetry={onRetryFirms}
              value={contractorId}
              onChange={setContractorId}
              boundFirm={boundFirm}
              initialId={initial.state.contractorId}
              disabled={pending}
            />
          )}
          {noFirmChosen && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Фирма не выбрана — заявки по этому типу создать нельзя. Тип можно сохранить так и
                привязать фирму позже.
              </span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.icon}>Значок (необязательно)</Label>
              <Input
                id={ids.icon}
                value={values.icon}
                onChange={(e) => setValue("icon", e.target.value)}
                aria-invalid={Boolean(shownError("icon"))}
                autoComplete="off"
                spellCheck={false}
                placeholder="например, tv или cctv"
                className="font-mono text-[13px]"
                disabled={pending}
              />
              {shownError("icon") && (
                <p className="text-[12px] text-destructive">{shownError("icon")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.sort}>Порядок на планшете</Label>
              <Input
                id={ids.sort}
                value={values.sort}
                onChange={(e) => setValue("sort", e.target.value)}
                aria-invalid={Boolean(shownError("sort"))}
                inputMode="numeric"
                autoComplete="off"
                disabled={pending}
              />
              {shownError("sort") ? (
                <p className="text-[12px] text-destructive">{shownError("sort")}</p>
              ) : (
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Меньше — выше в списке.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5 rounded-md border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={ids.active}>Тип активен</Label>
              <Switch
                id={ids.active}
                checked={active}
                onCheckedChange={setActive}
                disabled={pending}
              />
            </div>
            <p className="text-[12px] leading-snug text-muted-foreground">
              Выключенный тип пропадает с планшета, и заявку на него создать нельзя. Уже созданные
              заявки остаются и открываются как раньше. Удалить тип нельзя: его только выключают.
            </p>
          </div>
        </section>

        <FieldsEditor
          drafts={fields}
          initial={initial.byUid}
          issues={issues}
          disabled={pending}
          onChange={setFields}
        />
      </div>

      <SheetFooter className="shrink-0 flex-col items-stretch gap-2 border-t px-5 py-3">
        {(hasFormErrors || blocking.length > 0) && (
          <p role="status" className="text-[12px] leading-snug text-destructive">
            Сохранить нельзя:{" "}
            {firstFormError
              ? `${FORM_LABELS[firstFormError[0]]}: ${firstFormError[1]}`
              : `${blocking[0].where}: ${blocking[0].message}`}
            {blocking.length > (firstFormError ? 0 : 1)
              ? ` Ошибок в схеме: ${blocking.length}.`
              : ""}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={!canSave}>
            {pending ? "Сохраняем…" : mode === "create" ? "Создать" : "Сохранить"}
          </Button>
        </div>
      </SheetFooter>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Старые заявки потеряют подписи полей</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-[13px] leading-snug">
                <p>
                  <CountNote count={countState} />
                </p>
                <RiskList risks={risks} />
                <p>Значения в заявках не пропадут, но вернуть прежнюю подпись можно только вернув ключ.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Вернуться к правке</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Сохранить всё равно</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

// Выбор фирмы. Состояний больше, чем кажется: список фирм читается с другим
// правом (tickets.contractors.manage), он может грузиться, упасть или быть
// закрыт, а у типа фирма может быть уже выбрана, и тогда её нельзя снять.
function FirmControl({
  id,
  firms,
  onRetry,
  value,
  onChange,
  boundFirm,
  initialId,
  disabled,
}: {
  id: string;
  firms: FirmsState;
  onRetry: () => void;
  value: string;
  onChange: (v: string) => void;
  boundFirm: ContractorRow | null;
  // Фирма, с которой тип открыли; "" — не выбрана.
  initialId: string;
  disabled: boolean;
}) {
  const wasBound = initialId !== "";
  if (firms.status !== "ready") {
    const note =
      firms.status === "loading" ? (
        "Загружаем список фирм…"
      ) : firms.status === "denied" ? (
        <>
          Список фирм читается с правом{" "}
          <code className="font-mono text-[12px]">{CONTRACTORS_RIGHT}</code>. У вашей роли его
          нет, поэтому фирму отсюда не выбрать
          {wasBound ? ", а название текущей не показать." : "."}
        </>
      ) : (
        <>
          Не удалось загрузить список фирм: {firms.message}{" "}
          <button type="button" className="underline underline-offset-2" onClick={onRetry}>
            Повторить
          </button>
        </>
      );
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>Фирма</Label>
        <Select value={wasBound ? "bound" : NO_FIRM} disabled>
          <SelectTrigger id={id} className="w-full sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FIRM}>Не выбрана</SelectItem>
            <SelectItem value="bound">Выбрана (название недоступно)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[12px] leading-snug text-muted-foreground">{note}</p>
      </div>
    );
  }

  const list = firms.list;
  // Привязанной фирмы может не оказаться в справочнике; тогда её id всё равно
  // должен быть в списке пунктов, иначе Select покажет пустоту.
  const orphaned = wasBound && !boundFirm;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Фирма</Label>
      <Select
        value={value === "" ? NO_FIRM : value}
        onValueChange={(v) => onChange(v === NO_FIRM ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full sm:max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!wasBound && <SelectItem value={NO_FIRM}>Не выбрана</SelectItem>}
          {orphaned && <SelectItem value={initialId}>Фирма не найдена в справочнике</SelectItem>}
          {list.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
              {f.is_active ? "" : " (выключена)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[12px] leading-snug text-muted-foreground">
        {wasBound
          ? "Фирму можно заменить, но не снять: сервер не принимает пустое значение. Чтобы тип перестал принимать заявки, выключите его."
          : "Заявки этого типа уходят исполнителям выбранной фирмы."}
      </p>
    </div>
  );
}
