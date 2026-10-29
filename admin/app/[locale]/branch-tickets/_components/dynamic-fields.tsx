"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@admin/lib/utils";
import { Textarea } from "@components/ui/textarea";
import type { FieldDef } from "@admin/lib/tickets-api";
import { detailValue } from "@admin/lib/tickets-details";
import { MAX_TEXT, fieldState, type FieldValues } from "@admin/lib/tickets-create";

// Ряд кнопок-пилюль вместо <select>: на планшете выпадающий список — это
// системное колесо, в которое трудно попасть пальцем. Цель не ниже 44 px.
// Повторное нажатие на выбранную пилюлю снимает выбор, если поле не
// обязательное (allowClear).
export function PillGroup<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
  allowClear,
  disabled,
}: {
  labelledBy: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T | null) => void;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(on && allowClear ? null : o.value)}
            className={cn(
              "min-h-11 rounded-full border px-5 text-base outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent active:bg-accent"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Отрисовка fields_schema типа. Значения читаются только через detailValue:
// ключ схемы может быть «constructor», и values[key] вернул бы функцию.
// Значение, которого в схеме уже нет (администратор убрал вариант, пока форма
// была открыта), не рисуется выбранным и помечено, а на сервер не уходит: см.
// buildDetails.
export function DynamicFields({
  schema,
  values,
  onChange,
  disabled,
}: {
  schema: readonly FieldDef[];
  values: FieldValues;
  // Ключ и значение, а не новый объект целиком: владелец применяет их к
  // актуальному состоянию (setValues(prev => ...)), и два нажатия подряд до
  // перерисовки не затирают друг друга.
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("branchTickets.fields");
  const base = useId();
  return (
    <div className="space-y-5">
      {schema.map((f, i) => {
        const labelId = `${base}-l${i}`;
        const label = f.label_ru || f.key;
        const raw = detailValue(values, f.key);
        const text = typeof raw === "string" ? raw : "";
        const state = fieldState(f, values);
        return (
          <div key={f.key} className="space-y-2">
            <p id={labelId} className="flex flex-wrap items-baseline gap-x-2 text-base font-medium">
              <span>{label}</span>
              {f.required ? (
                <span className="text-sm font-normal text-muted-foreground">
                  <span aria-hidden className="text-destructive">*</span> {t("required")}
                </span>
              ) : (
                <span className="text-sm font-normal text-muted-foreground">{t("optional")}</span>
              )}
            </p>
            {f.type === "select" ? (
              <>
                <PillGroup
                  labelledBy={labelId}
                  value={f.options?.some((o) => o.value === text.trim()) ? text.trim() : null}
                  options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label_ru || o.value }))}
                  onChange={(v) => onChange(f.key, v ?? "")}
                  allowClear={!f.required}
                  disabled={disabled}
                />
                {state === "invalid" && (
                  <p className="text-sm text-destructive">{t("optionGone")}</p>
                )}
              </>
            ) : (
              <Textarea
                aria-labelledby={labelId}
                aria-invalid={state === "invalid"}
                value={text}
                rows={3}
                maxLength={MAX_TEXT}
                placeholder={t("describe")}
                disabled={disabled}
                onChange={(e) => onChange(f.key, e.target.value)}
                className="min-h-24 text-base md:text-base"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
