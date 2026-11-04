"use client";
import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@admin/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { cn } from "@admin/lib/utils";

export type MultiSelectOption = { value: string; label: string };

/** Сколько названий показывать на кнопке, остальные — счётчиком «+N». */
const SHOWN = 2;
/** Ключ строки «все» в cmdk: не совпадает с id и не пустой (пустой cmdk подменяет текстом строки). */
const ALL_KEY = "__all__";

type Props = {
  options: MultiSelectOption[];
  value: string[];
  onChange: (v: string[]) => void;
  /** Текст при пустом выборе: пустой массив значит «все». */
  allLabel: string;
  /** Что выбираем (карта, филиал). К имени кнопки добавляется текущий выбор; тем же текстом названы поле поиска и список. */
  ariaLabel: string;
  disabled?: boolean;
  /** Подсказка строки поиска внутри списка. */
  searchLabel?: string;
  /** Текст, когда поиск ничего не нашёл. */
  emptyLabel?: string;
};

/** Выбор нескольких значений: кнопка `h-11` как у соседних селектов, внутри Popover со списком и галочками. */
export function MultiSelect({ options, value, onChange, allLabel, ariaLabel, disabled, searchLabel, emptyLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(() => new Set(value), [value]);
  // Названия в порядке списка, а не в порядке щелчков: кнопка не прыгает.
  const names = useMemo(() => options.filter((o) => selected.has(o.value)).map((o) => o.label), [options, selected]);
  const shown = names.slice(0, SHOWN).join(", ");
  // Счётчик по value, а не по names: выбранное, которого уже нет в списке, всё равно уйдёт в запрос и не должно прятаться.
  const extra = value.length - Math.min(names.length, SHOWN);
  const empty = value.length === 0;
  const summary = empty ? allLabel : [shown, extra > 0 ? `+${extra}` : ""].filter(Boolean).join(" ");

  const needle = search.trim().toLowerCase();
  const visible = needle === "" ? options : options.filter((o) => o.label.toLowerCase().includes(needle));

  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // Видимый текст входит в имя: скринридер слышит и «что выбираем», и «что выбрано».
          aria-label={`${ariaLabel}: ${summary}`}
          disabled={disabled}
          className="h-11 w-full justify-between gap-2 px-3 font-normal sm:w-60"
        >
          <span className="flex min-w-0 items-center gap-2">
            {empty ? (
              <span className="truncate">{allLabel}</span>
            ) : (
              <>
                {shown !== "" && <span className="truncate">{shown}</span>}
                {extra > 0 && <span className="shrink-0 rounded-full bg-secondary px-2 text-xs">+{extra}</span>}
              </>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        // Ширина кнопки, но не уже 15rem и не шире экрана: на телефоне список не вылезает за край.
        className="w-[var(--radix-popover-trigger-width)] min-w-60 max-w-[calc(100vw-2rem)] p-0"
      >
        {/* Фильтр свой, не cmdk: ключ элемента — id, а не текст, и одинаковые названия не склеиваются. */}
        {/* label у Command cmdk привязывает к полю поиска (aria-labelledby), у списка он свой: иначе там английское «Suggestions». */}
        <Command shouldFilter={false} label={ariaLabel}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={searchLabel} />
          <CommandList label={ariaLabel} className="max-h-[min(18rem,50vh)]" aria-multiselectable="true">
            {visible.length === 0 && emptyLabel && <CommandEmpty>{emptyLabel}</CommandEmpty>}
            <CommandGroup>
              {needle === "" && <MultiSelectItem value={ALL_KEY} checked={empty} label={allLabel} onSelect={() => onChange([])} />}
              {visible.map((o) => (
                <MultiSelectItem key={o.value} value={o.value} checked={selected.has(o.value)} label={o.label} onSelect={() => toggle(o.value)} />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectItem({ value, checked, label, onSelect }: { value: string; checked: boolean; label: string; onSelect: () => void }) {
  return (
    <CommandItem value={value} aria-checked={checked} onSelect={onSelect} className="min-h-11 items-start py-2.5">
      <Check className={cn("mt-0.5 size-4 shrink-0", checked ? "opacity-100" : "opacity-0")} aria-hidden />
      <span className="min-w-0 break-words">{label}</span>
    </CommandItem>
  );
}
