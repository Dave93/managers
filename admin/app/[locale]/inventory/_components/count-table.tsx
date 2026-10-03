"use client";
import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@admin/components/ui/dropdown-menu";
import { Input } from "@admin/components/ui/input";
import { parseQtyInput } from "@admin/lib/inventory/qty";
import { isLineDone, type OverlayDetail, type OverlayLine } from "@admin/lib/inventory/queue";
import { EntriesPopover } from "./entries-popover";

type Filter = "all" | "todo" | "mine";

export function CountTable({
  detail,
  online,
  onAdd,
  onDelete,
  onSkip,
}: {
  detail: OverlayDetail;
  online: boolean;
  onAdd: (lineId: string, values: number[]) => void;
  onDelete: (entryId: string) => void;
  onSkip: (lineId: string, skipped: boolean) => void;
}) {
  const t = useTranslations("inventory");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const editable = detail.status === "draft" && detail.access === "write";

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = detail.lines.filter((l) => {
      if (q && !l.product_name.toLowerCase().includes(q)) return false;
      if (filter === "todo" && isLineDone(l)) return false;
      if (filter === "mine" && !l.entries.some((e) => e.created_by === detail.viewer_id)) return false;
      return true;
    });
    const map = new Map<string, OverlayLine[]>();
    for (const l of visible) map.set(l.group_name, [...(map.get(l.group_name) ?? []), l]);
    const all = new Map<string, OverlayLine[]>();
    for (const l of detail.lines) all.set(l.group_name, [...(all.get(l.group_name) ?? []), l]);
    return [...map.entries()].map(([name, lines]) => {
      const groupAll = all.get(name) ?? lines;
      return { name, lines, done: groupAll.filter(isLineDone).length, total: groupAll.length };
    });
  }, [detail, search, filter]);

  // Порядок полей ввода на экране — для перехода к следующей непосчитанной позиции.
  const order = useMemo(
    () => groups.filter((g) => !collapsed.has(g.name)).flatMap((g) => g.lines.map((l) => l.id)),
    [groups, collapsed]
  );
  const doneById = useMemo(() => new Map(detail.lines.map((l) => [l.id, isLineDone(l)])), [detail.lines]);

  const focusNext = (fromId: string) => {
    const idx = order.indexOf(fromId);
    for (let i = idx + 1; i < order.length; i++) {
      if (!doneById.get(order[i])) {
        const el = inputs.current.get(order[i]);
        if (el) {
          el.focus();
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        return;
      }
    }
  };

  const submitDraft = (line: OverlayLine) => {
    const raw = drafts[line.id] ?? "";
    const parsed = parseQtyInput(raw);
    if (!parsed.ok) {
      if (parsed.error !== "empty") toast.error(t("errors.invalidQty"));
      return;
    }
    onAdd(line.id, parsed.values);
    setDrafts((d) => ({ ...d, [line.id]: "" }));
    focusNext(line.id);
  };

  const toggle = (name: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("table.search")}
          className="h-11 flex-1 min-w-[180px]"
        />
        <div className="flex rounded-md border overflow-hidden">
          {(["all", "todo", "mine"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 min-h-[44px] text-sm ${filter === f ? "bg-primary text-primary-foreground" : ""}`}
            >
              {t(f === "all" ? "table.filterAll" : f === "todo" ? "table.filterTodo" : "table.filterMine")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_7.5rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_12rem_2.75rem] items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          <div>{t("table.product")}</div>
          <div>{t("table.unit")}</div>
          <div>{t("table.fact")}</div>
          <div />
        </div>
        {groups.length === 0 && <div className="p-4 text-sm text-muted-foreground">{t("table.nothing")}</div>}
        {groups.map((g) => (
          <Fragment key={g.name}>
            <button
              type="button"
              onClick={() => toggle(g.name)}
              className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 min-h-[44px] text-left text-sm font-semibold uppercase"
            >
              {collapsed.has(g.name) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="flex-1">{g.name}</span>
              <span className="tabular-nums font-normal normal-case">
                {g.done}/{g.total} {g.done === g.total ? "✓" : ""}
              </span>
            </button>
            {!collapsed.has(g.name) &&
              g.lines.map((line) => (
                <div
                  key={line.id}
                  className="grid grid-cols-[minmax(0,1fr)_2.25rem_7.5rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_12rem_2.75rem] items-center gap-2 border-b px-3 min-h-[44px]"
                >
                  <div className="py-2 text-sm leading-tight">
                    {line.product_name}
                    {line.source === "added" && <span className="ml-2 text-xs text-blue-600">{t("table.added")}</span>}
                    {line.skipped && <span className="ml-2 text-xs text-muted-foreground">{t("table.skipped")}</span>}
                  </div>
                  <div className="text-sm text-muted-foreground">{line.unit_name ?? ""}</div>
                  <div className="flex items-center gap-1">
                    <EntriesPopover
                      line={line}
                      viewerId={detail.viewer_id}
                      canDeleteAny={detail.can_manage}
                      editable={editable}
                      onDelete={onDelete}
                    />
                    {editable && !line.skipped && (
                      <Input
                        ref={(el) => {
                          if (el) inputs.current.set(line.id, el);
                          else inputs.current.delete(line.id);
                        }}
                        value={drafts[line.id] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitDraft(line);
                          }
                        }}
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        placeholder={line.entries.length ? "+" : t("table.enter")}
                        className="h-11 min-w-0 flex-1 tabular-nums"
                      />
                    )}
                  </div>
                  <div>
                    {editable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="menu">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={!online} onClick={() => onSkip(line.id, !line.skipped)}>
                            {line.skipped ? t("line.unskip") : t("line.skip")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
