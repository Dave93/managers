"use client";
import { useEffect, useMemo } from "react";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import { useIsMobile } from "@admin/utils/use-is-mobile";
import { cn } from "@admin/lib/utils";
import { BoardHeader } from "./board-header";
import { TerminalList } from "./terminal-list";
import { TerminalDetail } from "./terminal-detail";
import { ProductView } from "./product-view";
import { useBoard, useBoardModel } from "./use-board";

type Props = { view: "board" | "products"; onView: (v: "board" | "products") => void };

export function BoardView({ view, onView }: Props) {
  const [brand, setBrand] = useQueryState("brand", parseAsStringEnum(["les", "chopar"]));
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
  const [selected, setSelected] = useQueryState("t", parseAsString);
  const isMobile = useIsMobile();

  const query = useBoard(brand);
  const { terminals, products, kpi } = useBoardModel(query.data?.items, search);

  // Keep the selection meaningful as filters move: fall back to the hottest
  // terminal on desktop; on mobile an empty selection means "show the list".
  const selectedKey = useMemo(() => {
    if (selected && terminals.some((t) => t.key === selected)) return selected;
    return isMobile ? null : terminals[0]?.key ?? null;
  }, [selected, terminals, isMobile]);
  const selectedTerminal = terminals.find((t) => t.key === selectedKey) ?? null;

  useEffect(() => {
    if (selected && !query.isLoading && !terminals.some((t) => t.key === selected)) {
      setSelected(null);
    }
  }, [selected, terminals, query.isLoading, setSelected]);

  const openTerminal = (key: string) => {
    setSelected(key);
    onView("board");
  };

  if (query.error) {
    return (
      <div className="py-16 text-center text-sm text-red-500">
        Не удалось загрузить стоп-лист. Обновите страницу.
      </div>
    );
  }

  const header = (
    <BoardHeader
      brand={brand}
      onBrand={(b) => setBrand(b as "les" | "chopar" | null)}
      search={search}
      onSearch={(s) => setSearch(s || null)}
      kpi={query.data ? kpi : null}
      stats={query.data?.stats ?? null}
      syncedAt={query.data?.synced_at ?? null}
      isFetching={query.isFetching && !query.isLoading}
    />
  );

  if (view === "products") {
    return (
      <div className="space-y-3">
        {header}
        <ProductView
          products={products}
          showBrand={!brand}
          isLoading={query.isLoading}
          onOpenTerminal={openTerminal}
        />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="space-y-3">
        {!selectedTerminal && header}
        {selectedTerminal ? (
          <TerminalDetail
            terminal={selectedTerminal}
            isLoading={false}
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="rounded-lg border">
            <TerminalList
              terminals={terminals}
              selectedKey={null}
              onSelect={(k) => setSelected(k)}
              showBrand={!brand}
              isLoading={query.isLoading}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      <div
        className={cn(
          "grid grid-cols-[18rem_minmax(0,1fr)] overflow-hidden rounded-lg border",
          "h-[calc(100dvh-16rem)] min-h-[28rem]"
        )}
      >
        <div className="overflow-y-auto border-r">
          <TerminalList
            terminals={terminals}
            selectedKey={selectedKey}
            onSelect={(k) => setSelected(k)}
            showBrand={!brand}
            isLoading={query.isLoading}
          />
        </div>
        <div className="overflow-y-auto">
          <TerminalDetail terminal={selectedTerminal} isLoading={query.isLoading} />
        </div>
      </div>
    </div>
  );
}
