"use client";

import { useId, useState } from "react";
import { Check, Store } from "lucide-react";

import { cn } from "@admin/lib/utils";
import { Input } from "@components/ui/input";
import type { Branch } from "@admin/lib/tickets-create";
import { PillGroup } from "./dynamic-fields";

// До этого числа филиалы лежат пилюлями; больше — поиск и список: у части
// менеджеров закреплено 24-49 филиалов, ряд из полусотни пилюль не нужен.
const PILL_LIMIT = 8;

// Филиал, в который уйдёт заявка. Один закреплённый — только подпись; несколько
// — явный выбор без значения по умолчанию, иначе сервер молча взял бы первый.
export function BranchPicker({
  branches,
  chosenId,
  onChoose,
  disabled,
}: {
  branches: Branch[];
  chosenId: string | null;
  onChoose: (id: string | null) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const [query, setQuery] = useState("");

  if (branches.length === 1) {
    return (
      <div className="flex items-center gap-2 text-base">
        <Store className="size-5 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">Заявка уйдёт в филиал:</span>
        <span className="font-semibold">{branches[0].name}</span>
      </div>
    );
  }

  const chosen = branches.find((b) => b.id === chosenId) ?? null;
  const q = query.trim().toLowerCase();
  const shown = q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;

  return (
    <div className="space-y-2">
      <p id={labelId} className="flex flex-wrap items-baseline gap-x-2 text-base font-medium">
        <span>Филиал</span>
        <span className="text-sm font-normal text-muted-foreground">
          <span aria-hidden className="text-destructive">*</span> обязательно, за вами закреплено {branches.length}
        </span>
      </p>
      {branches.length <= PILL_LIMIT ? (
        <PillGroup
          labelledBy={labelId}
          value={chosen?.id ?? null}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          onChange={onChoose}
          disabled={disabled}
        />
      ) : (
        <div className="space-y-2">
          {chosen && (
            <p className="flex items-center gap-2 text-base">
              <Check className="size-5 text-emerald-600" aria-hidden />
              <span className="text-muted-foreground">Выбран:</span>
              <span className="font-semibold">{chosen.name}</span>
            </p>
          )}
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Поле стоит внутри формы: Enter или «Перейти» на экранной
            // клавиатуре (так её убирают) отправил бы заявку. Гасим и убираем
            // фокус, чтобы клавиатура закрылась, как человек и ожидает.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            enterKeyHint="search"
            // Поле не принадлежит форме (атрибут form указывает на несуществующий
            // id): тогда у него нет формы-владельца, и неявная отправка по
            // Enter/Go невозможна ни на какой клавиатуре, включая те, где клавиша
            // приходит как Unidentified и keydown выше не срабатывает.
            form="branch-search-no-form"
            placeholder="Найти филиал"
            aria-label="Найти филиал"
            disabled={disabled}
            className="h-11 text-base md:text-base"
          />
          <div role="radiogroup" aria-labelledby={labelId} className="max-h-64 overflow-y-auto rounded-lg border">
            {shown.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Такого филиала нет среди закреплённых за вами.</p>
            ) : (
              shown.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={b.id === chosenId}
                  disabled={disabled}
                  onClick={() => onChoose(b.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 border-b px-4 text-left text-base last:border-b-0 hover:bg-accent focus-visible:bg-accent",
                    b.id === chosenId && "bg-accent font-semibold"
                  )}
                >
                  {b.name}
                  {b.id === chosenId && <Check className="size-5" aria-hidden />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
