"use client";

import { useEffect, useRef } from "react";
import {
  Armchair, Cctv, Droplets, Flame, Hammer, Lightbulb, Monitor, Paintbrush, Plug, Printer,
  Snowflake, Trash2, Tv, Wifi, Wrench, Zap, TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@admin/lib/utils";
import type { TicketTypeRow } from "@admin/lib/tickets-api";
import { lacksContractor, sortTypes } from "@admin/lib/tickets-create";

// Поле icon у типа — свободная строка с именем значка («tv», «cctv»), которую
// вводит администратор. Карта, а не динамический импорт: весь набор lucide в
// клиентский бандл не нужен. Незнакомое имя даёт гаечный ключ. Именно Map: у
// обычного объекта значок «constructor» вернул бы функцию из прототипа.
const ICONS = new Map<string, LucideIcon>([
  ["tv", Tv], ["cctv", Cctv], ["monitor", Monitor], ["printer", Printer], ["wifi", Wifi],
  ["plug", Plug], ["zap", Zap], ["lightbulb", Lightbulb], ["snowflake", Snowflake],
  ["flame", Flame], ["droplets", Droplets], ["hammer", Hammer], ["wrench", Wrench],
  ["armchair", Armchair], ["paintbrush", Paintbrush], ["trash-2", Trash2],
]);

export function TypeIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS.get(name.trim().toLowerCase())) || Wrench;
  return <Icon className={className} aria-hidden />;
}

// Плитка типа без подрядной фирмы остаётся видимой и нажимаемой: нажатие
// объясняет, а не ведёт дальше. Это aria-disabled, а не disabled: отключённая
// кнопка молчит, и менеджер решил бы, что планшет завис.
export function TypeTiles({
  types,
  selectedId,
  blockedId,
  onPick,
  onBlocked,
}: {
  types: TicketTypeRow[];
  selectedId?: string | null;
  blockedId?: string | null;
  onPick: (t: TicketTypeRow) => void;
  onBlocked: (t: TicketTypeRow) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {sortTypes(types).map((t) => {
        const blocked = lacksContractor(t);
        return (
          <li key={t.id}>
            <button
              type="button"
              aria-disabled={blocked || undefined}
              aria-pressed={selectedId === t.id}
              aria-describedby={blocked ? `type-blocked-${t.id}` : undefined}
              onClick={() => (blocked ? onBlocked(t) : onPick(t))}
              className={cn(
                "flex h-full min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 px-3 py-4 text-center outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                blocked
                  ? "border-dashed bg-muted/40 text-muted-foreground"
                  : "bg-card hover:bg-accent active:bg-accent",
                blockedId === t.id && "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
                selectedId === t.id && "border-primary"
              )}
            >
              <TypeIcon name={t.icon} className={cn("size-9", blocked && "opacity-60")} />
              <span className="text-lg font-semibold leading-tight">{t.name_ru}</span>
              <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
              {blocked && (
                <span id={`type-blocked-${t.id}`} className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Фирма не назначена
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Пояснение к нажатой плитке без фирмы. Ведущий текст про администратора:
// менеджер сам ничего не исправит, и ему нужно знать, к кому идти.
export function TypeBlockedNotice({ type }: { type: TicketTypeRow }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Под сеткой из многих плиток пояснение может оказаться ниже экрана.
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [type.id]);
  return (
    <div
      ref={ref}
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-500/60 bg-amber-50 px-4 py-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="text-base font-semibold leading-snug">«{type.name_ru}» пока недоступен</p>
        <p className="text-sm leading-snug">
          Для этого типа не назначена подрядная фирма, и заявке некому уйти. Создать её сейчас нельзя.
          Выберите другой тип или сообщите администратору: он назначит фирму в разделе «Типы заявок».
        </p>
      </div>
    </div>
  );
}
