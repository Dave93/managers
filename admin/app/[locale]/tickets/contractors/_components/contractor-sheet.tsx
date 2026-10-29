"use client";

// Панель фирмы: создание и правка. Черновик живёт в теле панели, а ключ
// «эпоха» из useSheetSession пересоздаёт тело при каждом новом открытии, так
// что закрытая и открытая снова панель не помнит прошлых правок и ошибок.
//
// PUT не принимает null: стереть телефон или примечание можно только пустой
// строкой, поэтому "" в строке справочника читается как «не указано».
// Отправляем только изменённые поля, чтобы не перезаписать то, что за время
// правки поменял другой сотрудник.

import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Switch } from "@components/ui/switch";
import { Textarea } from "@components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import type { ContractorRow, ContractorUpdateInput } from "@admin/lib/tickets-api";

import { useContractorActions, useMutationErrorText, useSheetSession } from "./use-contractors";

export type ContractorTarget = { kind: "create" } | { kind: "edit"; id: string };

export function ContractorSheet({
  target,
  firms,
  onClose,
  onSaved,
}: {
  target: ContractorTarget | null;
  firms: ContractorRow[];
  onClose: () => void;
  // Вызывается с фирмой, которую только что создали, чтобы страница её выбрала.
  onSaved?: (row: ContractorRow) => void;
}) {
  const { shown, epoch } = useSheetSession(target);
  const row = shown?.kind === "edit" ? (firms.find((f) => f.id === shown.id) ?? null) : null;

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        {shown !== null && (
          <ContractorBody
            key={`${shown.kind === "edit" ? shown.id : "new"}:${epoch}`}
            mode={shown.kind}
            row={row}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ContractorBody({
  mode,
  row,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  row: ContractorRow | null;
  onClose: () => void;
  onSaved?: (row: ContractorRow) => void;
}) {
  const t = useTranslations("ticketsUi.contractors.firmSheet");
  const mutationErrorText = useMutationErrorText();
  const ids = { name: useId(), phone: useId(), note: useId(), active: useId() };
  const actions = useContractorActions();

  // Начальные значения запоминаем один раз: сравнение «что изменилось» идёт
  // с тем, что человек увидел при открытии, а не с тем, что прилетело при
  // фоновом обновлении списка.
  const [initial] = useState(() => ({
    name: row?.name ?? "",
    phone: row?.phone ?? "",
    note: row?.note ?? "",
    active: row?.is_active ?? true,
  }));
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [note, setNote] = useState(initial.note);
  const [active, setActive] = useState(initial.active);
  // Подсказку «обязательно» показываем после первого ввода или ухода из поля,
  // а не на пустой свежей форме.
  const [touched, setTouched] = useState(false);

  const mutation = mode === "create" ? actions.create : actions.update;
  const pending = mutation.isPending;
  const error = mutation.error;

  if (mode === "edit" && row === null) {
    return (
      <>
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <SheetTitle className="text-base">{t("firm")}</SheetTitle>
          <SheetDescription className="sr-only">{t("editFirm")}</SheetDescription>
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

  const trimmed = {
    name: name.trim(),
    phone: phone.trim(),
    note: note.trim(),
  };
  const patch: ContractorUpdateInput = {};
  if (trimmed.name !== initial.name) patch.name = trimmed.name;
  if (trimmed.phone !== initial.phone) patch.phone = trimmed.phone;
  if (trimmed.note !== initial.note) patch.note = trimmed.note;
  if (active !== initial.active) patch.is_active = active;
  const dirty = Object.keys(patch).length > 0;
  const nameMissing = trimmed.name === "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || nameMissing) return;
    if (mode === "create") {
      actions.create.mutate(
        {
          name: trimmed.name,
          ...(trimmed.phone ? { phone: trimmed.phone } : {}),
          ...(trimmed.note ? { note: trimmed.note } : {}),
        },
        {
          onSuccess: (created) => {
            onSaved?.(created);
            onClose();
          },
        }
      );
    } else if (row && dirty) {
      actions.update.mutate({ id: row.id, body: patch }, { onSuccess: onClose });
    }
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
        <SheetTitle className="text-base">
          {mode === "create" ? t("newFirm") : initial.name || t("firm")}
        </SheetTitle>
        <SheetDescription className="text-[12px]">
          {mode === "create"
            ? t("createDesc")
            : t("editDesc")}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="space-y-1.5">
          <Label htmlFor={ids.name}>{t("name")}</Label>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            maxLength={200}
            autoComplete="off"
            aria-invalid={touched && nameMissing}
            disabled={pending}
          />
          {touched && nameMissing && (
            <p className="text-[12px] text-destructive">{t("nameRequired")}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.phone}>{t("phone")}</Label>
          <Input
            id={ids.phone}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.note}>{t("note")}</Label>
          <Textarea
            id={ids.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            disabled={pending}
          />
        </div>
        {mode === "edit" && (
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
        )}
        {error ? (
          <p role="alert" className="break-words text-[12.5px] leading-snug text-destructive">
            {mutationErrorText(error)}
          </p>
        ) : null}
      </div>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || nameMissing || (mode === "edit" && !dirty)}>
          {pending ? t("saving") : mode === "create" ? t("create") : t("save")}
        </Button>
      </SheetFooter>
    </form>
  );
}
