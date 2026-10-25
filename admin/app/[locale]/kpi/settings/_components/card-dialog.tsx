"use client";
import React, { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Switch } from "@admin/components/ui/switch";
import { kpiApi, type Card } from "@admin/lib/kpi-api";
import { KpiApiError, kpiErrorText } from "@admin/lib/kpi/errors";
import { cardCodeOk, parseRoleCodes } from "@admin/lib/kpi/settings";
import { useStaffRoles } from "@admin/lib/staff-roles";
import { qk } from "../../_components/use-kpi";

const CODE_HINT = "Латиница в нижнем регистре, цифры и _, от 2 до 40 символов";

type Values = {
  code: string;
  title_ru: string;
  title_uz: string;
  roles: string[];
  rolesText: string;
  sort: string;
  active: boolean;
};

function sortOk(s: string): boolean {
  if (s.trim() === "") return true;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 100000;
}

export function CardDialog({ card, open, onClose }: { card: Card | null; open: boolean; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <CardForm key={card?.id ?? "new"} card={card} onClose={onClose} onPending={setPending} />
        ) : (
          <>
            <DialogTitle className="sr-only">Карта</DialogTitle>
            <DialogDescription className="sr-only">Карта</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({ card, onClose, onPending }: { card: Card | null; onClose: () => void; onPending: (p: boolean) => void }) {
  const qc = useQueryClient();
  const roles = useStaffRoles({ activeOnly: true });
  const [codeError, setCodeError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      code: "",
      title_ru: card?.title_ru ?? "",
      title_uz: card?.title_uz ?? "",
      roles: card?.staff_role_codes ?? [],
      rolesText: (card?.staff_role_codes ?? []).join(", "),
      sort: card ? String(card.sort) : "",
      active: card?.active ?? true,
    } as Values,
    onSubmit: ({ value }) => save.mutate(value),
  });

  const save = useMutation({
    mutationFn: (v: Values) => {
      // Список ролей недоступен без employees.list: тогда роли вводятся текстом.
      const staff_role_codes = roles.isError ? parseRoleCodes(v.rolesText) : v.roles;
      const sort = v.sort.trim() === "" ? undefined : Number(v.sort);
      if (card) {
        return kpiApi.cards.update(card.id, {
          title_ru: v.title_ru.trim(),
          title_uz: v.title_uz.trim(),
          staff_role_codes,
          active: v.active,
          ...(sort !== undefined ? { sort } : {}),
        });
      }
      return kpiApi.cards.create({
        code: v.code.trim(),
        title_ru: v.title_ru.trim(),
        title_uz: v.title_uz.trim(),
        staff_role_codes,
        ...(sort !== undefined ? { sort } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.cardsAll });
      toast.success("Карта сохранена");
      onClose();
    },
    onError: (e) => {
      if (e instanceof KpiApiError && e.code === "code_taken") setCodeError(kpiErrorText(e));
      else toast.error(kpiErrorText(e));
    },
  });

  const busy = save.isPending;
  useEffect(() => {
    onPending(busy);
    return () => onPending(false);
  }, [busy, onPending]);

  // Роли карты, которых нет среди активных: не теряем их молча при сохранении.
  const known = new Set((roles.data ?? []).map((r) => r.code));

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
        <DialogTitle>{card ? "Карта" : "Новая карта"}</DialogTitle>
        <DialogDescription>{card ? card.code : "Карта оценки сотрудника"}</DialogDescription>
      </DialogHeader>

      {!card && (
        <form.Field name="code">
          {(field) => {
            const v = field.state.value;
            const bad = v !== "" && !cardCodeOk(v);
            return (
              <div className="space-y-1">
                <Label htmlFor="card-code">Код</Label>
                <Input
                  id="card-code"
                  className="h-11"
                  value={v}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(e) => {
                    setCodeError(null);
                    field.handleChange(e.target.value);
                  }}
                />
                <p className={bad || codeError ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={bad || codeError ? "alert" : undefined}>
                  {codeError ?? CODE_HINT}
                </p>
              </div>
            );
          }}
        </form.Field>
      )}

      <form.Field name="title_ru">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="card-title-ru">Название (рус.)</Label>
            <Input id="card-title-ru" className="h-11" value={field.state.value} disabled={busy} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      </form.Field>
      <form.Field name="title_uz">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="card-title-uz">Название (узб.)</Label>
            <Input id="card-title-uz" className="h-11" value={field.state.value} disabled={busy} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      </form.Field>

      <div className="space-y-1">
        <Label>Должности, которым карта выдаётся автоматически</Label>
        {roles.isError ? (
          <form.Field name="rolesText">
            {(field) => (
              <div className="space-y-1">
                <Input
                  aria-label="Коды ролей через запятую"
                  placeholder="Коды ролей через запятую"
                  className="h-11"
                  value={field.state.value}
                  disabled={busy}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">Справочник должностей недоступен, коды вводятся вручную</p>
              </div>
            )}
          </form.Field>
        ) : roles.isPending ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : (
          <form.Field name="roles">
            {(field) => {
              const selected = field.state.value;
              const extra = selected.filter((c) => !known.has(c));
              const options = [
                ...(roles.data ?? []).map((r) => ({ code: r.code, label: r.name_ru })),
                ...extra.map((c) => ({ code: c, label: `${c} (нет среди активных)` })),
              ];
              const toggle = (code: string, on: boolean) =>
                field.handleChange(on ? [...selected, code] : selected.filter((c) => c !== code));
              return (
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                  {options.length === 0 && <p className="text-sm text-muted-foreground">Должностей нет</p>}
                  {options.map((o) => (
                    <label key={o.code} className="flex min-h-9 items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.includes(o.code)} disabled={busy} onChange={(e) => toggle(o.code, e.target.checked)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              );
            }}
          </form.Field>
        )}
      </div>

      <form.Field name="sort">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="card-sort">Порядок</Label>
            <Input
              id="card-sort"
              type="number"
              inputMode="numeric"
              className="h-11 w-32"
              value={field.state.value}
              disabled={busy}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {!sortOk(field.state.value) && (
              <p role="alert" className="text-sm text-destructive">
                Порядок — целое число от 0 до 100000
              </p>
            )}
          </div>
        )}
      </form.Field>

      {card && (
        <form.Field name="active">
          {(field) => (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Switch checked={field.state.value} disabled={busy} onCheckedChange={field.handleChange} />
              Карта включена
            </label>
          )}
        </form.Field>
      )}

      <form.Subscribe selector={(s) => s.values}>
        {(values) => {
          const ok =
            (card !== null || cardCodeOk(values.code)) &&
            values.title_ru.trim() !== "" &&
            values.title_uz.trim() !== "" &&
            sortOk(values.sort);
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
