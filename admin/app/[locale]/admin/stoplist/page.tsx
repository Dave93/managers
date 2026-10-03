"use client";
import { Suspense } from "react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { cn } from "@admin/lib/utils";
import { BoardView } from "./board/board-view";
import { HistoryView } from "./history-view";

const VIEWS = [
  { value: "board", label: "По филиалам" },
  { value: "products", label: "По продуктам" },
  { value: "history", label: "История" },
] as const;
type View = (typeof VIEWS)[number]["value"];

function StoplistContent() {
  const [view, setView] = useQueryState(
    "view",
    parseAsStringEnum<View>(["board", "products", "history"]).withDefault("board")
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 pb-3">
        <h2 className="text-2xl font-bold tracking-tight">Стоп-лист</h2>
        <nav className="flex gap-1" aria-label="Режим">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                view === v.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {v.label}
            </button>
          ))}
        </nav>
        {view === "history" && (
          <span
            className="ml-auto text-xs text-muted-foreground"
            title="История стоп-листа собирается с 13.08.2026; более ранние периоды неполные"
          >
            полные данные с 13.08.2026
          </span>
        )}
      </div>
      {view === "history" ? (
        <HistoryView />
      ) : (
        <BoardView view={view} onView={(v) => setView(v)} />
      )}
    </div>
  );
}

export default function StoplistPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-muted-foreground">Загрузка…</div>}>
      <StoplistContent />
    </Suspense>
  );
}
