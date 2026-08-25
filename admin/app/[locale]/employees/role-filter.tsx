"use client";

import { Check, ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@admin/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui/popover";
import { groupRoles, roleLabel, useStaffRoles } from "@admin/lib/staff-roles";

// Фильтр по роли на экране сотрудников.
//
// Был Select, писавший название роли в текстовый ?position=, который ищет
// подстрокой: выбор «Повар» показывал 205 человек — со старшими, универсалами и
// стажёрами. Теперь отсюда уходит ?staff_role_id= с точным совпадением, и
// «Повар» значит ровно повара.
//
// Множественный выбор — не украшение: «покажи всю кухню» на этом экране
// спрашивают чаще, чем одну роль, а через одиночный список это четыре запроса
// подряд. Отсюда же кнопка на заголовке группы: она отмечает группу целиком.
export default function RoleFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const tEmp = useTranslations("attestation.employees");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { data: roles } = useStaffRoles();

  const grouped = useMemo(() => groupRoles(roles ?? []), [roles]);
  const selected = useMemo(() => new Set(value), [value]);

  const groupLabel = (g: string) =>
    ["kitchen", "front", "management", "other"].includes(g)
      ? tEmp(`groups.${g}` as any)
      : g;

  const label = useMemo(() => {
    if (!value.length) return tEmp("role");
    const picked = (roles ?? []).filter((r) => selected.has(r.id));
    if (picked.length === 1) return roleLabel(picked[0], locale);
    // Целая группа выбрана — так её и называем: «Кухня (5)» читается быстрее
    // перечисления пяти ролей и ровно так этот выбор и делали.
    const whole = grouped.find(
      (g) =>
        g.roles.length === picked.length &&
        g.roles.every((r) => selected.has(r.id))
    );
    if (whole) return `${groupLabel(whole.group)} (${picked.length})`;
    return `${tEmp("role")}: ${picked.length}`;
  }, [value, roles, selected, grouped, locale]);

  const toggle = (id: string) =>
    onChange(
      selected.has(id) ? value.filter((v) => v !== id) : [...value, id]
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-[220px] justify-between font-normal"
        >
          <span className={cn("truncate", !value.length && "text-muted-foreground")}>
            {label}
          </span>
          {value.length ? (
            <X
              className="ml-2 h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={tEmp("roleSearch")} />
          <CommandList>
            <CommandEmpty>{tEmp("roleNotFound")}</CommandEmpty>
            {grouped.map(({ group, roles: inGroup }) => {
              const ids = inGroup.map((r) => r.id);
              const allOn = ids.every((id) => selected.has(id));
              return (
                <CommandGroup key={group} heading={groupLabel(group)}>
                  <CommandItem
                    value={`__group_${group}`}
                    onSelect={() =>
                      onChange(
                        allOn
                          ? value.filter((v) => !ids.includes(v))
                          : Array.from(new Set([...value, ...ids]))
                      )
                    }
                    className="text-muted-foreground"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        allOn ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {groupLabel(group)} — {tEmp("roleWholeGroup")}
                  </CommandItem>
                  {inGroup.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`${r.name_ru} ${r.name_uz} ${r.code}`}
                      onSelect={() => toggle(r.id)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selected.has(r.id) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {roleLabel(r, locale)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
