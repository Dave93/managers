"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@admin/lib/utils";
import { Skeleton } from "@admin/components/ui/skeleton";
import { BRAND_LABEL, fmtDateTime, fmtDuration, severityClass, terminalsWord } from "./format";
import type { ProductGroup } from "./use-board";

type Props = {
  products: ProductGroup[];
  showBrand: boolean;
  isLoading: boolean;
  onOpenTerminal: (key: string) => void;
};

function ProductRow({
  p,
  showBrand,
  onOpenTerminal,
}: {
  p: ProductGroup;
  showBrand: boolean;
  onOpenTerminal: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const n = p.terminals.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
      >
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{p.name}</span>
            {showBrand && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {BRAND_LABEL[p.brand] ?? p.brand}
              </span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {n} {terminalsWord(n)}
            {p.freshCount > 0 ? `, ${p.freshCount} за сутки` : ""}
          </span>
        </span>
        <span className={cn("shrink-0 text-sm tabular-nums", severityClass(p.maxSeconds))}>
          до {fmtDuration(p.maxSeconds)}
        </span>
        <span
          className={cn(
            "w-8 shrink-0 text-right text-base font-semibold tabular-nums",
            p.freshCount > 0 ? "text-foreground" : "text-muted-foreground/60"
          )}
        >
          {n}
        </span>
      </button>
      {open && (
        <ul className="divide-y border-t bg-muted/20 pl-10 pr-3">
          {p.terminals.map(({ terminal, position }) => (
            <li key={terminal.key} className="flex items-center gap-3 py-1.5">
              <button
                type="button"
                onClick={() => onOpenTerminal(terminal.key)}
                className="min-w-0 flex-1 text-left text-sm hover:underline"
              >
                {terminal.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  с {fmtDateTime(position.started_at)}
                </span>
              </button>
              <span className={cn("text-sm tabular-nums", severityClass(position.seconds))}>
                {fmtDuration(position.seconds)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProductView({ products, showBrand, isLoading, onOpenTerminal }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-1 p-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-sm text-muted-foreground">
        Ничего не найдено
      </div>
    );
  }
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="ml-7 flex-1">Продукт · в скольких филиалах в стопе сейчас</span>
        <span>самый долгий</span>
        <span className="w-8 text-right">филиалов</span>
      </div>
      <ul className="divide-y">
        {products.map((p) => (
          <ProductRow key={p.key} p={p} showBrand={showBrand} onOpenTerminal={onOpenTerminal} />
        ))}
      </ul>
    </div>
  );
}
