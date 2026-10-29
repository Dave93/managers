"use client";
import React, { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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

export function ItemDialog({
  cardId,
  item,
  defaultWeight,
  open,
  onClose,
}: {
  cardId: string;
  item: CardItem | null;
  defaultWeight: number;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("kpi");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <ItemForm key={item?.id ?? `new-${cardId}`} cardId={cardId} item={item} defaultWeight={defaultWeight} onClose={onClose} onPending={setPending} />
        ) : (
          <>
            <DialogTitle className="sr-only">{t("settings.itemDialog.srTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("settings.itemDialog.srTitle")}</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({
  cardId,
  item,
  defaultWeight,
  onClose,
  onPending,
}: {
  cardId: string;
  item: CardItem | null;
  defaultWeight: number;
  onClose: () => void;
  onPending: (p: boolean) => void;
}) {
  const t = useTranslations("kpi");
  const qc = useQueryClient();

  const form = useForm({
    defaultValues: {
      title_ru: item?.title_ru ?? "",
      title_uz: item?.title_uz ?? "",
      hint_ru: item?.hint_ru ?? "",
      hint_uz: item?.hint_uz ?? "",
      source: item?.source ?? "manual",
      weight: String(item ? item.weight : defaultWeight),
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
      toast.success(t("settings.itemDialog.saved"));
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e, t)),
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
              {t("settings.itemDialog.titleMax", { max: TITLE_MAX })}
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
        <DialogTitle>{item ? t("settings.itemDialog.titleEdit") : t("settings.itemDialog.titleNew")}</DialogTitle>
        <DialogDescription>{t("settings.itemDialog.description")}</DialogDescription>
      </DialogHeader>

      {titleField("title_ru", t("settings.itemDialog.titleRu"))}
      {titleField("title_uz", t("settings.itemDialog.titleUz"))}
      {hintField("hint_ru", t("settings.itemDialog.hintRu"))}
      {hintField("hint_uz", t("settings.itemDialog.hintUz"))}

      <form.Field name="source">
        {(field) => (
          <div className="space-y-1">
            <Label>{t("settings.itemDialog.source")}</Label>
            <Select value={field.state.value} disabled={busy} onValueChange={(v) => field.handleChange(v as ItemSource)}>
              <SelectTrigger className="h-11 w-full" aria-label={t("settings.itemDialog.source")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_SOURCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                    {!o.ready && ` ${t("settings.itemDialog.sourceNoData")}`}
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
              <Label htmlFor="item-weight">{t("settings.itemDialog.weight")}</Label>
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
                {t("settings.itemDialog.weightHint")}
              </p>
            </div>
          )}
        </form.Field>
        <form.Field name="sort">
          {(field) => (
            <div className="space-y-1">
              <Label htmlFor="item-sort">{t("settings.itemDialog.sort")}</Label>
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
                  {t("settings.itemDialog.sortError")}
                </p>
              )}
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="group_key">
        {(field) => (
          <div className="space-y-1">
            <Label>{t("settings.itemDialog.group")}</Label>
            <Select value={field.state.value} disabled={busy} onValueChange={(v) => field.handleChange(v as "base" | "extra")}>
              <SelectTrigger className="h-11 w-full" aria-label={t("settings.itemDialog.group")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">{t("settings.itemDialog.groupBase")}</SelectItem>
                <SelectItem value="extra">{t("settings.itemDialog.groupExtra")}</SelectItem>
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
              {t("settings.itemDialog.enabled")}
            </label>
          )}
        </form.Field>
      )}

      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        {t("settings.itemDialog.note")}
      </p>

      <form.Subscribe selector={(s) => s.values}>
        {(values) => {
          const ok = titleOk(values.title_ru) && titleOk(values.title_uz) && weightOk(values.weight) && sortOk(values.sort);
          return (
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
                {t("settings.itemDialog.cancel")}
              </Button>
              <Button type="submit" className="h-11" disabled={busy || !ok}>
                {t("settings.itemDialog.save")}
              </Button>
            </DialogFooter>
          );
        }}
      </form.Subscribe>
    </form>
  );
}
