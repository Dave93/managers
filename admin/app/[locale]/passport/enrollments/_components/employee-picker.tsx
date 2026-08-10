"use client";

// Employee search over the attestation registry.
//
// Built from Popover + a plain input + a listbox rather than from cmdk's
// <Command>: this admin's components/ui/command.tsx pins `value` to "" unless
// a controlled value is passed, and cmdk filters client-side by default, both
// of which fight a debounced SERVER search. The house precedent for a
// server-filtered picker is the same Popover-composition
// (components/filters/terminals/TerminalsFilter.tsx), so nothing new is being
// invented here.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, ShieldAlert } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { cn } from "@admin/lib/utils";
import {
  fullName,
  useEmployeeSearch,
  type EmployeeOption,
} from "./use-enrollments";

export function EmployeePicker({
  value,
  onChange,
  terminalName,
  disabled,
}: {
  value: EmployeeOption | null;
  onChange: (e: EmployeeOption | null) => void;
  terminalName: (id: string | null) => string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => setCursor(0), [debounced]);

  const q = useEmployeeSearch(debounced, open);
  const rows = q.data ?? [];
  // 403 here is a real configuration, not an edge case: `employees.list` and
  // `passport.enrollments.manage` are separate permissions and no seed grants
  // them together, so an HR account can hold one without the other.
  const denied = q.isError && q.error?.status === 403;

  const pick = (e: EmployeeOption) => {
    onChange(e);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = rows[cursor];
      if (hit) pick(hit);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto w-full justify-between px-3 py-2 text-left font-normal"
        >
          {value ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">
                {fullName(value.first_name, value.last_name)}
              </span>
              <span className="truncate text-[11.5px] text-muted-foreground">
                {value.position || "должность не указана"} ·{" "}
                {terminalName(value.terminal_id)}
              </span>
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground">
              Выберите сотрудника
            </span>
          )}
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Фамилия или имя"
            className="h-8 pl-7 text-[13px]"
          />
        </div>

        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {denied ? (
            <div className="flex items-start gap-2 px-2 py-3 text-[12px] leading-snug text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                Нет доступа к реестру сотрудников — не хватает права{" "}
                <code className="font-mono text-[11px]">employees.list</code>.
                Оно отдельное от{" "}
                <code className="font-mono text-[11px]">
                  passport.enrollments.manage
                </code>
                : попросите администратора добавить его вашей роли. Без реестра
                выбрать стажёра здесь не получится.
              </span>
            </div>
          ) : q.isLoading ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Загрузка…
            </p>
          ) : q.isError ? (
            <p className="px-2 py-3 text-[12px] text-destructive">
              {q.error?.message}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">
              {debounced
                ? "Никого не нашли. Проверьте написание фамилии."
                : "Начните вводить фамилию."}
            </p>
          ) : (
            rows.map((e, i) => {
              const selected = value?.id === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(e)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors",
                    i === cursor && "bg-accent text-accent-foreground"
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      selected ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px]">
                      {fullName(e.first_name, e.last_name)}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {e.position || "должность не указана"} ·{" "}
                      {terminalName(e.terminal_id)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {q.isFetching && !q.isLoading && (
          <p className="border-t px-3 py-1 text-[11px] text-muted-foreground">
            обновляем…
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
