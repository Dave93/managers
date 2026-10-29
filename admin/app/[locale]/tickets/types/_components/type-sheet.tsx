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
import { useTranslations } from "next-intl";

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
import { FieldsEditor, Segmented, useIssueText } from "./fields-editor";
import {
  buildCreateBody,
  buildUpdatePatch,
  needsConfirmation,
  noRisks,
  orphanRisks,
  prefixChange,
  schemaSignature,
  toDrafts,
  validateDrafts,
  validateTypeForm,
  type FormState,
  type OrphanRisks,
  type PrefixChange,
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
  const t = useTranslations("ticketsUi.types.sheet");
  // Число считает GET /tickets в пределах филиалов сессии, поэтому оно
  // только поясняет и ничего не разрешает: подтверждение показывается всегда.
  if (count.state === "known") {
    return count.n > 0 ? (
      <>{t("countKnown", { count: count.n })}</>
    ) : (
      <>{t("countZero")}</>
    );
  }
  if (count.state === "checking") {
    return <>{t("countChecking")}</>;
  }
  return (
    <>
      {t.rich("countUnknown", {
        right: LIST_RIGHT,
        code: (chunks) => <code className="font-mono text-[12px]">{chunks}</code>,
      })}
    </>
  );
}

export function RiskList({
  risks,
  prefix = null,
}: {
  risks: OrphanRisks;
  prefix?: PrefixChange | null;
}) {
  const t = useTranslations("ticketsUi.types.sheet");
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
      {prefix && (
        <li>{t("riskPrefix", { from: prefix.from, to: prefix.to })}</li>
      )}
      {risks.renamed.map((r) => (
        <li key={`rn:${r.from}`}>
          {t("riskRenamed", {
            from: r.from,
            to: r.to,
            reused: risks.reused.includes(r.from) ? "yes" : "no",
          })}
        </li>
      ))}
      {risks.removed.map((k) => (
        <li key={`rm:${k}`}>
          {t("riskRemoved", { key: k, reused: risks.reused.includes(k) ? "yes" : "no" })}
        </li>
      ))}
      {risks.reused.map((k) => (
        <li key={`ru:${k}`} className="font-medium">
          {t("riskReused", { key: k })}
        </li>
      ))}
      {risks.optionLoss.map((o) => (
        <li key={`op:${o.key}`}>
          {o.toText
            ? t("riskToText", { key: o.key })
            : t("riskOptionsLost", {
                key: o.key,
                values: o.values.map((v) => `«${v}»`).join(", "),
              })}
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
  const t = useTranslations("ticketsUi.types.sheet");
  const tForm = useTranslations("ticketsUi.types.form");
  const tProblem = useTranslations("ticketsUi.types.problem");
  const tl = useTranslations("ticketsLib");
  const issueText = useIssueText();
  const kinds = [
    { value: "external", label: t("kindExternal") },
    { value: "staff", label: t("kindStaff") },
  ] as const;
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

  const formErrors = validateTypeForm(values, mode, initial.state.values, (k, v) => tForm(k, v));
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
  // Счётчик только для формулировки диалога. Известным он считается, лишь
  // пока нет ни ошибки, ни перезапроса: TanStack держит прошлые данные, когда
  // перезапрос упал или ещё летит, и закэшированный ноль с прошлого открытия
  // не должен выдавать себя за свежий.
  const countState: React.ComponentProps<typeof CountNote>["count"] =
    count.isError
      ? { state: "unknown" }
      : count.data !== undefined && !count.isFetching
        ? { state: "known", n: count.data }
        : { state: "checking" };
  // Подтверждение нужно всегда, когда у правки есть риски. Раньше точный ноль
  // его пропускал, но GET /tickets считает только филиалы сессии, а у админских
  // учёток терминалы выданы: ноль у них значит «здесь нет», не «нигде нет».
  const prefixChanged = prefixChange(mode, initial.state.values.number_prefix, values.number_prefix);
  const needsConfirm = needsConfirmation(mode, risks, prefixChanged);

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
          <SheetTitle className="text-base">{t("ticketType")}</SheetTitle>
          <SheetDescription className="sr-only">{t("editTicketType")}</SheetDescription>
        </SheetHeader>
        <div role="alert" className="flex items-start gap-3 px-5 py-6">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[12.5px] leading-snug text-muted-foreground">
            {t("notFound")}
          </p>
        </div>
      </>
    );
  }

  const shownError = (k: keyof TypeFormValues) =>
    touched[k] || mode === "edit" ? formErrors[k] : undefined;
  const problem = error ? serverProblem(error, (k, v) => tProblem(k, v), tl) : null;

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
          {mode === "create" ? t("newTicketType") : initial.state.values.name_ru || t("ticketType")}
        </SheetTitle>
        <SheetDescription className="text-[12px]">
          {mode === "create"
            ? t("createDesc")
            : t("editDesc")}
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

        <section aria-label={t("main")} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.nameRu}>{t("formLabels.name_ru")}</Label>
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
              <Label htmlFor={ids.nameUz}>{t("formLabels.name_uz")}</Label>
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
              <Label htmlFor={ids.code}>{t("formLabels.code")}</Label>
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
                    placeholder={t("codePlaceholder")}
                    className="font-mono text-[13px]"
                    disabled={pending}
                  />
                  {shownError("code") ? (
                    <p className="text-[12px] text-destructive">{shownError("code")}</p>
                  ) : (
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      {t("codeUnique")}
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
                    {t("codeLocked")}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={ids.prefix}>{t("formLabels.number_prefix")}</Label>
              <Input
                id={ids.prefix}
                value={values.number_prefix}
                onChange={(e) => setValue("number_prefix", e.target.value.toUpperCase())}
                onBlur={() => setTouched((p) => ({ ...p, number_prefix: true }))}
                aria-invalid={Boolean(shownError("number_prefix"))}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("prefixPlaceholder")}
                className="font-mono text-[13px]"
                disabled={pending}
              />
              {shownError("number_prefix") && (
                <p className="text-[12px] text-destructive">{shownError("number_prefix")}</p>
              )}
              {mode === "edit" ? (
                <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[12px] leading-snug text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {t("prefixWarning")}
                </p>
              ) : (
                <p className="text-[12px] leading-snug text-muted-foreground">
                  {t("prefixPreview", { example: `${values.number_prefix.trim() || "TV"}-000123` })}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label id={ids.kind}>{t("executor")}</Label>
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
                  options={kinds}
                  disabled={pending}
                  labelledBy={ids.kind}
                />
              </div>
            ) : (
              <p className="text-[13px]">
                {initial.state.kind === "external" ? t("kindExternal") : t("kindStaff")}
                <span className="ml-2 text-[12px] text-muted-foreground">
                  {t("codeLocked")}
                </span>
              </p>
            )}
          </div>

          {kind === "staff" ? (
            <p className="text-[12px] leading-snug text-muted-foreground">
              {t("staffNote")}
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
                {t("noFirmNote")}
              </span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.icon}>{t("iconOptional")}</Label>
              <Input
                id={ids.icon}
                value={values.icon}
                onChange={(e) => setValue("icon", e.target.value)}
                aria-invalid={Boolean(shownError("icon"))}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("iconPlaceholder")}
                className="font-mono text-[13px]"
                disabled={pending}
              />
              {shownError("icon") && (
                <p className="text-[12px] text-destructive">{shownError("icon")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.sort}>{t("formLabels.sort")}</Label>
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
                  {t("sortHint")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5 rounded-md border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={ids.active}>{t("active")}</Label>
              <Switch
                id={ids.active}
                checked={active}
                onCheckedChange={setActive}
                disabled={pending}
              />
            </div>
            <p className="text-[12px] leading-snug text-muted-foreground">
              {t("activeHint")}
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
            {t("cannotSave")}{" "}
            {firstFormError
              ? `${t(`formLabels.${firstFormError[0]}`)}: ${firstFormError[1]}`
              : `${issueText.where(blocking[0])}: ${issueText.message(blocking[0])}`}
            {blocking.length > (firstFormError ? 0 : 1)
              ? ` ${t("schemaErrors", { count: blocking.length })}`
              : ""}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {pending ? t("saving") : mode === "create" ? t("create") : t("save")}
          </Button>
        </div>
      </SheetFooter>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-[13px] leading-snug">
                <p>
                  <CountNote count={countState} />
                </p>
                <RiskList risks={risks} prefix={prefixChanged} />
                {!noRisks(risks) && (
                  <p>{t("confirmNote")}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmBack")}</AlertDialogCancel>
            <AlertDialogAction onClick={save}>{t("confirmSave")}</AlertDialogAction>
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
  const t = useTranslations("ticketsUi.types.sheet");
  const tt = useTranslations("ticketsUi.table");
  const wasBound = initialId !== "";
  if (firms.status !== "ready") {
    const note =
      firms.status === "loading" ? (
        t("firmsLoading")
      ) : firms.status === "denied" ? (
        <>
          {t.rich(wasBound ? "firmsDeniedBound" : "firmsDenied", {
            right: CONTRACTORS_RIGHT,
            code: (chunks) => <code className="font-mono text-[12px]">{chunks}</code>,
          })}
        </>
      ) : (
        <>
          {t("firmsLoadFailed", { message: firms.message })}{" "}
          <button type="button" className="underline underline-offset-2" onClick={onRetry}>
            {tt("retry")}
          </button>
        </>
      );
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{t("firm")}</Label>
        <Select value={wasBound ? "bound" : NO_FIRM} disabled>
          <SelectTrigger id={id} className="w-full sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FIRM}>{t("firmNone")}</SelectItem>
            <SelectItem value="bound">{t("firmBoundUnknown")}</SelectItem>
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
      <Label htmlFor={id}>{t("firm")}</Label>
      <Select
        value={value === "" ? NO_FIRM : value}
        onValueChange={(v) => onChange(v === NO_FIRM ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full sm:max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!wasBound && <SelectItem value={NO_FIRM}>{t("firmNone")}</SelectItem>}
          {orphaned && <SelectItem value={initialId}>{t("firmNotFound")}</SelectItem>}
          {list.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
              {f.is_active ? "" : ` ${t("firmDisabledParen")}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[12px] leading-snug text-muted-foreground">
        {wasBound
          ? t("firmReplaceHint")
          : t("firmSendHint")}
      </p>
    </div>
  );
}
