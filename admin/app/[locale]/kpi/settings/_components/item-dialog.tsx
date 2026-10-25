"use client";
import React, { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Switch } from "@admin/components/ui/switch";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type CardItem, type ItemSource } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { ITEM_SOURCE_OPTIONS } from "@admin/lib/kpi/settings";
import { qk } from "../../_components/use-kpi";

const TITLE_MAX = 300;

type Values = {
  title_ru: string;
  title_uz: string;
  hint_ru: string;
  hint_uz: string;
  source: ItemSource;
  weight: string;
  group_key: "base" | "extra";
  sort: string;
  active: boolean;
};

function weightOk(s: string): boolean {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 100;
}
function sortOk(s: string): boolean {
  if (s.trim() === "") return true;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 100000;
}
function titleOk(s: string): boolean {
  const t = s.trim();
  return t !== "" && t.length <= TITLE_MAX;
}

export function ItemDialog({ cardId, item, open, onClose }: { cardId: string; item: CardItem | null; open: boolean; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <ItemForm key={item?.id ?? `new-${cardId}`} cardId={cardId} item={item} onClose={onClose} onPending={setPending} />
        ) : (
          <>
            <DialogTitle className="sr-only">Пункт карты</DialogTitle>
            <DialogDescription className="sr-only">Пункт карты</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({ cardId, item, onClose, onPending }: { cardId: string; item: CardItem | null; onClose: () => void; onPending: (p: boolean) => void }) {
  const qc = useQueryClient();

  const form = useForm({
    defaultValues: {
      title_ru: item?.title_ru ?? "",
      title_uz: item?.title_uz ?? "",
      hint_ru: item?.hint_ru ?? "",
      hint_uz: item?.hint_uz ?? "",
      source: item?.source ?? "manual",
      weight: item ? String(item.weight) : "10",
      group_key: item?.group_key ?? "base",
      sort: item ? String(item.sort) : "",
      active: item?.active ?? true,
    } as Values,
    onSubmit: ({ value }) => save.mutate(value),
  });

  const save = useMutation({
    mutationFn: (v: Values) => {
      const sort = v.sort.trim() === "" ? undefined : Number(v.sort);
      const base = {
        title_ru: v.title_ru.trim(),
        title_uz: v.title_uz.trim(),
        source: v.source,
        weight: Number(v.weight),
        group_key: v.group_key,
        ...(sort !== undefined ? { sort } : {}),
      };
      if (item) {
        // Пустая подсказка при правке очищает её на сервере.
        return kpiApi.cards.updateItem(item.id, { ...base, hint_ru: v.hint_ru.trim(), hint_uz: v.hint_uz.trim(), active: v.active });
      }
      return kpiApi.cards.addItem(cardId, {
        ...base,
        ...(v.hint_ru.trim() ? { hint_ru: v.hint_ru.trim() } : {}),
        ...(v.hint_uz.trim() ? { hint_uz: v.hint_uz.trim() } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.cardsAll });
      qc.invalidateQueries({ queryKey: qk.formAll });
      toast.success("Пункт сохранён");
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  const busy = save.isPending;
  useEffect(() => {
    onPending(busy);
    return () => onPending(false);
  }, [busy, onPending]);

  const titleField = (name: "title_ru" | "title_uz", label: string) => (
    <form.Field name={name}>
      {(field) => (
        <div className="space-y-1">
          <Label htmlFor={`item-${name}`}>{label}</Label>
          <Input id={`item-${name}`} className="h-11" value={field.state.value} disabled={busy} onChange={(e) => field.handleChange(e.target.value)} />
          {field.state.value.trim().length > TITLE_MAX && (
            <p role="alert" className="text-sm text-destructive">
              Не больше {TITLE_MAX} символов
            </p>
          )}
        </div>
      )}
    </form.Field>
  );

  const hintField = (name: "hint_ru" | "hint_uz", label: string) => (
    <form.Field name={name}>
      {(field) => (
        <div className="space-y-1">
          <Label htmlFor={`item-${name}`}>{label}</Label>
          <Textarea id={`item-${name}`} rows={2} value={field.state.value} disabled={busy} onChange={(e) => field.handleChange(e.target.value)} />
        </div>
      )}
    </form.Field>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) form.handleSubmit();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{item ? "Пункт карты" : "Новый пункт"}</DialogTitle>
        <DialogDescription>Критерий, по которому оценщик ставит балл</DialogDescription>
      </DialogHeader>

      {titleField("title_ru", "Название (рус.)")}
      {titleField("title_uz", "Название (узб.)")}
      {hintField("hint_ru", "Подсказка оценщику (рус.)")}
      {hintField("hint_uz", "Подсказка оценщику (узб.)")}

      <form.Field name="source">
        {(field) => (
          <div className="space-y-1">
            <Label>Источник</Label>
            <Select value={field.state.value} disabled={busy} onValueChange={(v) => field.handleChange(v as ItemSource)}>
              <SelectTrigger className="h-11 w-full" aria-label="Источник">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_SOURCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                    {!o.ready && " — данных пока нет, оценивается вручную"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <div className="flex flex-wrap gap-4">
        <form.Field name="weight">
          {(field) => (
            <div className="space-y-1">
              <Label htmlFor="item-weight">Вес</Label>
              <Input
                id="item-weight"
                type="number"
                inputMode="numeric"
                className="h-11 w-28"
                value={field.state.value}
                disabled={busy}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <p className={weightOk(field.state.value) ? "text-sm text-muted-foreground" : "text-sm text-destructive"} role={weightOk(field.state.value) ? undefined : "alert"}>
                Вес — целое от 1 до 100
              </p>
            </div>
          )}
        </form.Field>
        <form.Field name="sort">
          {(field) => (
            <div className="space-y-1">
              <Label htmlFor="item-sort">Порядок</Label>
              <Input
                id="item-sort"
                type="number"
                inputMode="numeric"
                className="h-11 w-28"
                value={field.state.value}
                disabled={busy}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {!sortOk(field.state.value) && (
                <p role="alert" className="text-sm text-destructive">
                  Целое от 0 до 100000
                </p>
              )}
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="group_key">
        {(field) => (
          <div className="space-y-1">
            <Label>Группа</Label>
            <Select value={field.state.value} disabled={busy} onValueChange={(v) => field.handleChange(v as "base" | "extra")}>
              <SelectTrigger className="h-11 w-full" aria-label="Группа">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">Основной</SelectItem>
                <SelectItem value="extra">Дополнительный</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      {item && (
        <form.Field name="active">
          {(field) => (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Switch checked={field.state.value} disabled={busy} onCheckedChange={field.handleChange} />
              Пункт включён
            </label>
          )}
        </form.Field>
      )}

      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        Отправленные оценки хранят снимок пунктов. Правка действует на новые оценки и черновики
      </p>

      <form.Subscribe selector={(s) => s.values}>
        {(values) => {
          const ok = titleOk(values.title_ru) && titleOk(values.title_uz) && weightOk(values.weight) && sortOk(values.sort);
          return (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" className="h-11" disabled={busy || !ok}>
                Сохранить
              </Button>
            </DialogFooter>
          );
        }}
      </form.Subscribe>
    </form>
  );
}
