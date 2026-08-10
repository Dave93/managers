"use client";

// Программа → Модули → Темы.
//
// There is no tree component in this admin, so this is Collapsible + a plain
// nested list, kept deliberately dense: one line per node, 13px type, hover
// affordances only. It is a working surface an editor keeps open all day, not
// a landing page.
//
// The one thing that is never quiet is an unfilled RU/UZ pair — LangPips paint
// it amber on the topic row AND aggregate it onto the module row, because that
// is precisely what will refuse publication later.
//
// DRAG-SORT: first @dnd-kit usage in this codebase (the packages were
// installed and unused). One DndContext per module, over that module's topics.
// Notes that cost a rebuild if changed carelessly:
//   * listeners go on the grip only — putting them on the row swallows the
//     click that selects/opens the node;
//   * PointerSensor gets an 8px activation distance, otherwise a plain click
//     on the grip is interpreted as a drag;
//   * the sortable list includes INACTIVE topics. `sort` is a column on the
//     whole table; dropping hidden rows out of the list lets the reindex
//     collide with them;
//   * a published module is frozen (topic writes 409) so dragging is disabled
//     outright rather than offered and refused.

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  Eye,
  FileQuestion,
  GripVertical,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@components/ui/tooltip";
import { cn } from "@admin/lib/utils";
import {
  listTopics,
  updateTopic,
  type PassportModule,
  type PassportTopic,
} from "@admin/lib/passport-api";

import {
  VERIFICATION_LABELS,
  hasObservation,
  hasQuiz,
  isUnsignable,
  publishTopics,
  topicMissingLangs,
} from "./completeness";
import { LangPips, StatusDot } from "./status";
import {
  apiMessage,
  qk,
  unwrap,
  type CurriculumAccess,
} from "./use-curriculum";

export interface TreeHandlers {
  selectedModuleId: string | null;
  selectedTopicId: string | null;
  onSelectModule: (m: PassportModule) => void;
  onEditTopic: (t: PassportTopic, m: PassportModule) => void;
  onCreateTopic: (m: PassportModule, nextSort: number) => void;
}

function VerificationIcon({ topic }: { topic: PassportTopic }) {
  const vt = topic.verification_type;
  if (isUnsignable(vt))
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">
          «{VERIFICATION_LABELS[vt]}» — такую тему нельзя подписать на текущем
          этапе, публикация модуля будет отклонена
        </TooltipContent>
      </Tooltip>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground/70">
          {hasQuiz(vt) && <FileQuestion className="size-3.5" />}
          {hasObservation(vt) && <Eye className="size-3.5" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{VERIFICATION_LABELS[vt]}</TooltipContent>
    </Tooltip>
  );
}

function TopicRow({
  topic,
  index,
  module: mod,
  handlers,
  draggable,
}: {
  topic: PassportTopic;
  index: number;
  module: PassportModule;
  handlers: TreeHandlers;
  draggable: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topic.id, disabled: !draggable });

  const missing = topicMissingLangs(topic);
  const selected = handlers.selectedTopicId === topic.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/topic flex items-center gap-1.5 rounded px-1 py-1 text-[13px]",
        "hover:bg-muted/60",
        selected && "bg-accent hover:bg-accent",
        isDragging && "relative z-10 bg-background shadow-md ring-1 ring-border"
      )}
    >
      {draggable ? (
        <button
          type="button"
          aria-label="Перетащить тему"
          className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/topic:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="size-[18px] shrink-0" />
      )}
      <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={() => handlers.onEditTopic(topic, mod)}
        className="min-w-0 flex-1 truncate text-left"
      >
        <span
          className={cn(
            "truncate",
            !topic.active && "text-muted-foreground line-through",
            !topic.title_ru.trim() && "italic text-muted-foreground"
          )}
        >
          {topic.title_ru.trim() || "Без названия"}
        </span>
      </button>
      <VerificationIcon topic={topic} />
      <LangPips ru={missing.ru} uz={missing.uz} />
    </div>
  );
}

function ModuleNode({
  module: mod,
  topics,
  topicsLoading,
  handlers,
  access,
  canEditThis,
  showDepartment,
}: {
  module: PassportModule;
  topics: PassportTopic[] | undefined;
  topicsLoading: boolean;
  handlers: TreeHandlers;
  access: CurriculumAccess;
  canEditThis: boolean;
  showDepartment: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Rendered order is `sort`; inactive topics stay in the list (muted) so the
  // reindex below can never collide with a hidden row.
  const ordered = useMemo(
    () => (topics ?? []).slice().sort((a, b) => a.sort - b.sort),
    [topics]
  );
  const ids = useMemo(() => ordered.map((t) => t.id), [ordered]);

  const missing = useMemo(() => {
    let ru = 0;
    let uz = 0;
    // The module's own title pair counts too — it blocks publication exactly
    // like a topic's does.
    if (!mod.title_ru.trim()) ru += 1;
    if (!mod.title_uz.trim()) uz += 1;
    for (const t of publishTopics(ordered)) {
      const m = topicMissingLangs(t);
      if (m.ru) ru += 1;
      if (m.uz) uz += 1;
    }
    return { ru, uz };
  }, [mod.title_ru, mod.title_uz, ordered]);

  const unsignableCount = useMemo(
    () => publishTopics(ordered).filter((t) => isUnsignable(t.verification_type)).length,
    [ordered]
  );

  const sensors = useSensors(
    // 8px before a press becomes a drag, or clicking the grip starts one.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const reorder = useMutation({
    mutationFn: async (next: PassportTopic[]) => {
      // Persist only the rows whose position actually moved, sequentially —
      // a reorder normally touches 2-3 rows.
      const changed = next
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => t.sort !== i);
      for (const { t, i } of changed) {
        const { error } = await updateTopic(t.id, { sort: i });
        if (error) throw new Error(apiMessage(error));
      }
      return changed.length;
    },
    onError: (e: any) => {
      toast.error(`Порядок не сохранён: ${e?.message ?? "ошибка"}`);
      // Roll back to the server's truth rather than leaving the optimistic
      // order on screen pretending it was saved.
      queryClient.invalidateQueries({ queryKey: qk.topics(mod.id) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.topics(mod.id) });
    },
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ordered, from, to).map((t, i) => ({ ...t, sort: i }));
    // Optimistic: the row lands where it was dropped immediately; onError
    // above invalidates and the server order comes back.
    queryClient.setQueryData(qk.topics(mod.id), {
      total: next.length,
      data: next,
    });
    reorder.mutate(next);
  };

  const selected = handlers.selectedModuleId === mod.id;
  const dragAllowed = canEditThis;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-md px-1 py-1.5 text-sm transition-colors duration-150",
          "hover:bg-muted/70",
          selected && "bg-accent hover:bg-accent"
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={open ? "Свернуть" : "Развернуть"}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150 ease-out",
                open && "rotate-90"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <StatusDot status={mod.status} active={mod.active} />
        <button
          type="button"
          onClick={() => handlers.onSelectModule(mod)}
          className="min-w-0 flex-1 truncate text-left focus-visible:outline-none"
        >
          <span
            className={cn(
              "truncate font-medium",
              !mod.active && "text-muted-foreground line-through",
              !mod.title_ru.trim() && "italic text-muted-foreground"
            )}
          >
            {mod.title_ru.trim() || "Без названия"}
          </span>
          {mod.version > 1 && (
            <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">
              v{mod.version}
            </span>
          )}
        </button>
        {showDepartment && (
          <span className="hidden shrink-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground/70 lg:inline max-w-[92px]">
            {mod.owner_department}
          </span>
        )}
        {unsignableCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">
                <AlertTriangle className="size-3" />
                {unsignableCount}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px]">
              Тем с неподписываемым типом проверки: {unsignableCount}. Публикация
              будет отклонена, пока тип не изменён.
            </TooltipContent>
          </Tooltip>
        )}
        <LangPips ru={missing.ru} uz={missing.uz} />
        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
          {topicsLoading && topics === undefined ? "…" : ordered.length}
        </span>
      </div>

      <CollapsibleContent>
        <div className="ml-[13px] border-l border-border/60 py-0.5 pl-2">
          {topicsLoading && ordered.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> загрузка тем…
            </div>
          )}
          {!topicsLoading && ordered.length === 0 && (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">
              Тем пока нет. Модуль без тем опубликовать нельзя.
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {ordered.map((t, i) => (
                <TopicRow
                  key={t.id}
                  topic={t}
                  index={i}
                  module={mod}
                  handlers={handlers}
                  draggable={dragAllowed}
                />
              ))}
            </SortableContext>
          </DndContext>
          {reorder.isPending && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> сохраняем порядок…
            </div>
          )}
          {canEditThis && (
            <button
              type="button"
              onClick={() => handlers.onCreateTopic(mod, ordered.length)}
              className="mt-0.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
            >
              <Plus className="size-3.5" /> Добавить тему
            </button>
          )}
          {!canEditThis && mod.status === "published" && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              Модуль опубликован — темы заморожены.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CurriculumTree({
  modules,
  access,
  handlers,
  canEditModule,
  showDepartment,
}: {
  modules: PassportModule[];
  access: CurriculumAccess;
  handlers: TreeHandlers;
  canEditModule: (m: PassportModule) => boolean;
  showDepartment: boolean;
}) {
  // One topics query per visible module: the module row's language marker is
  // the point of the tree, and there is no batch topics endpoint. Cached for a
  // minute so expanding/collapsing does not refetch.
  const topicQueries = useQueries({
    queries: modules.map((m) => ({
      queryKey: qk.topics(m.id),
      queryFn: () => unwrap(listTopics(m.id)),
      staleTime: 60_000,
    })),
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-px">
        {modules.map((m, i) => {
          const q = topicQueries[i];
          return (
            <ModuleNode
              key={m.id}
              module={m}
              topics={(q?.data as any)?.data as PassportTopic[] | undefined}
              topicsLoading={!!q?.isLoading}
              handlers={handlers}
              access={access}
              canEditThis={canEditModule(m)}
              showDepartment={showDepartment}
            />
          );
        })}
      </div>
    </TooltipProvider>
  );
}
