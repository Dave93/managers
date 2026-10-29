"use client";
import { Suspense } from "react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";
import { BoardView } from "./board/board-view";
import { HistoryView } from "./history-view";

// Подписи — stoplistPage.views.<value>.
const VIEWS = [
  { value: "board" },
  { value: "products" },
  { value: "history" },
] as const;
type View = (typeof VIEWS)[number]["value"];

function StoplistContent() {
  const t = useTranslations("stoplistPage");
  const [view, setView] = useQueryState(
    "view",
    parseAsStringEnum<View>(["board", "products", "history"]).withDefault("board")
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 pb-3">
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <nav className="flex gap-1" aria-label={t("viewsAria")}>
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
              {t(`views.${v.value}`)}
            </button>
          ))}
        </nav>
        {view === "history" && (
          <span
            className="ml-auto text-xs text-muted-foreground"
            title={t("historyNoteTitle")}
          >
            {t("historyNote")}
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

function StoplistFallback() {
  const t = useTranslations("stoplistPage");
  return <div className="py-10 text-center text-sm text-muted-foreground">{t("loading")}</div>;
}

export default function StoplistPage() {
  return (
    <Suspense fallback={<StoplistFallback />}>
      <StoplistContent />
    </Suspense>
  );
}
