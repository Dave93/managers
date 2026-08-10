"use client";

// Конструктор куррикулума — the screen where HR and the head-office
// departments author the programme every new employee is taught from.
//
// Layout: programme picker + dense tree on the left (sticky, scrolls on its
// own), the selected module's lifecycle and publish-readiness on the right.
// Editing itself happens in a Sheet, per the house pattern — the tree stays
// visible behind it, which matters when the thing you are fixing is a topic
// the publish gate just named.
//
// Degradations that are deliberate, not oversights:
//  * GET /passport/programs is gated on `passport.matrix.view` while this page
//    is reachable with `passport.curriculum.edit`. An editor without
//    matrix.view gets 403 on the programme list — the page says so plainly and
//    falls back to the flat, unfiltered module list, which is still scoped to
//    their department by the backend.
//  * That module list fails CLOSED when the user's `users.department` is
//    empty: the backend returns nothing. Without its own empty state that
//    reads as "нет модулей" and turns into a bug report.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, BookOpen, Info, Plus, Search } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { Switch } from "@components/ui/switch";
import { cn } from "@admin/lib/utils";
import type {
  PassportModule,
  PassportProgram,
  PassportTopic,
} from "@admin/lib/passport-api";

import { CurriculumTree, type TreeHandlers } from "./_components/curriculum-tree";
import { ModulePanel } from "./_components/module-panel";
import { ModuleSheet } from "./_components/module-sheet";
import { ProgramSheet } from "./_components/program-sheet";
import { TopicSheet } from "./_components/topic-sheet";
import {
  moduleIsWritable,
  useCurriculumAccess,
  useModules,
  usePrograms,
  useTopics,
} from "./_components/use-curriculum";

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={cn("text-[15px] font-semibold tabular-nums", tone)}>
        {value}
      </span>
      <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export default function CurriculumPage() {
  // Page chrome goes through next-intl like the rest of the admin. The
  // operational prose inside the editors (consequence dialogs, publish
  // blockers, the translated 422 list) stays Russian in place: the brief asks
  // for those "по-русски", they are written for HR and head office, and
  // machine-translating a "this will be visible to every trainee" warning into
  // a locale nobody operates in would be worse than showing the original.
  const t = useTranslations("passport.curriculum");
  const access = useCurriculumAccess();

  const [programId, setProgramId] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  const [programSheet, setProgramSheet] = useState<{
    open: boolean;
    program: PassportProgram | null;
  }>({ open: false, program: null });
  const [moduleSheet, setModuleSheet] = useState<{
    open: boolean;
    module: PassportModule | null;
  }>({ open: false, module: null });
  const [topicSheet, setTopicSheet] = useState<{
    open: boolean;
    topic: PassportTopic | null;
    module: PassportModule | null;
    nextSort: number;
  }>({ open: false, topic: null, module: null, nextSort: 0 });

  const programs = usePrograms();
  const programsDenied = programs.isError && programs.error?.status === 403;
  const programList = programs.data?.data ?? [];

  useEffect(() => {
    if (!programId && programList.length) setProgramId(programList[0].id);
  }, [programId, programList]);

  // Programme-filtered list; when the programme list is unavailable we simply
  // never set a programId and this collapses to the flat list below.
  const scoped = useModules(programId, includeInactive, !!programId);
  // Always fetched: it is both the fallback list and the source of the
  // "не привязаны к программе" group (a module created here, or forked by
  // «Новая версия», exists but belongs to no programme until HR links it).
  const all = useModules(null, includeInactive);

  const attachedIds = useMemo(
    () => new Set((scoped.data?.data ?? []).map((m) => m.id)),
    [scoped.data]
  );

  const matches = (m: PassportModule) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      m.title_ru.toLowerCase().includes(q) ||
      m.title_uz.toLowerCase().includes(q) ||
      m.owner_department.toLowerCase().includes(q)
    );
  };

  const inProgram = useMemo(
    () => (programId ? (scoped.data?.data ?? []).filter(matches) : []),
    [programId, scoped.data, filter]
  );
  const unattached = useMemo(
    () =>
      (all.data?.data ?? []).filter(
        (m) => (!programId || !attachedIds.has(m.id)) && matches(m)
      ),
    [all.data, attachedIds, programId, filter]
  );

  const everyModule = useMemo(
    () => [...(scoped.data?.data ?? []), ...(all.data?.data ?? [])],
    [scoped.data, all.data]
  );
  const selectedModule =
    everyModule.find((m) => m.id === selectedModuleId) ?? null;

  const selectedTopics = useTopics(selectedModuleId);
  const topicRows = (selectedTopics.data?.data ?? []) as PassportTopic[];

  const counts = useMemo(() => {
    const seen = new Map<string, PassportModule>();
    for (const m of everyModule) seen.set(m.id, m);
    const list = [...seen.values()];
    return {
      total: list.length,
      published: list.filter((m) => m.status === "published").length,
      review: list.filter((m) => m.status === "review").length,
      draft: list.filter((m) => m.status === "draft").length,
      retired: list.filter((m) => !m.active).length,
    };
  }, [everyModule]);

  const canEditModule = (m: PassportModule) => moduleIsWritable(m, access);

  const handlers: TreeHandlers = {
    selectedModuleId,
    selectedTopicId: topicSheet.open ? topicSheet.topic?.id ?? null : null,
    onSelectModule: (m) => setSelectedModuleId(m.id),
    onEditTopic: (topic, m) =>
      setTopicSheet({ open: true, topic, module: m, nextSort: topic.sort }),
    onCreateTopic: (m, nextSort) =>
      setTopicSheet({ open: true, topic: null, module: m, nextSort }),
  };

  const noDepartmentScope =
    access.ready && !access.canPublish && !access.department;

  const listLoading = all.isLoading || (!!programId && scoped.isLoading);

  return (
    <div className="pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-[12px] text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {access.canPublish && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProgramSheet({ open: true, program: null })}
            >
              <Plus className="mr-1.5 size-3.5" /> {t("newProgram")}
            </Button>
          )}
          {access.canEdit && (
            <Button
              size="sm"
              onClick={() => setModuleSheet({ open: true, module: null })}
            >
              <Plus className="mr-1.5 size-3.5" /> {t("newModule")}
            </Button>
          )}
        </div>
      </div>

      {programsDenied && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{t("programsDenied")}</span>
        </div>
      )}

      {noDepartmentScope && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] leading-snug">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{t("noDepartment")}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* ---------------- left: picker + tree ---------------- */}
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div className="space-y-3 rounded-lg border bg-card p-3">
            {!programsDenied && (
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("program")}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={programId ?? ""}
                    onValueChange={(v) => {
                      setProgramId(v);
                      setSelectedModuleId(null);
                    }}
                    disabled={programs.isLoading || programList.length === 0}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue
                        placeholder={
                          programs.isLoading
                            ? t("programsLoading")
                            : t("noPrograms")
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {programList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            <span className={cn(!p.active && "line-through")}>
                              {p.position}
                            </span>
                            <span className="text-muted-foreground">
                              {p.title_ru}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {access.canPublish && programId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setProgramSheet({
                          open: true,
                          program:
                            programList.find((p) => p.id === programId) ?? null,
                        })
                      }
                    >
                      {t("editProgram")}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("search")}
                className="h-8 pl-8 text-[13px]"
              />
            </div>

            <div className="grid grid-cols-4 gap-2 rounded-md bg-muted/50 px-3 py-2">
              <Metric label={t("metricTotal")} value={counts.total} />
              <Metric
                label={t("metricPublished")}
                value={counts.published}
                tone="text-emerald-600 dark:text-emerald-400"
              />
              <Metric
                label={t("metricReview")}
                value={counts.review}
                tone="text-amber-600 dark:text-amber-400"
              />
              <Metric label={t("metricRetired")} value={counts.retired} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="include-inactive"
                className="text-[12px] font-normal text-muted-foreground"
              >
                {t("showRetired")}
              </Label>
              <Switch
                id="include-inactive"
                checked={includeInactive}
                onCheckedChange={setIncludeInactive}
              />
            </div>
          </div>

          <div className="mt-3 rounded-lg border bg-card p-2">
            {listLoading && (
              <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                {t("loadingModules")}
              </p>
            )}

            {!listLoading && programId && (
              <>
                <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("inProgram")} · {inProgram.length}
                </p>
                {inProgram.length === 0 ? (
                  <p className="px-2 py-3 text-[12px] text-muted-foreground">
                    {access.canPublish
                      ? t("emptyProgramHr")
                      : t("emptyProgram")}
                  </p>
                ) : (
                  <CurriculumTree
                    modules={inProgram}
                    access={access}
                    handlers={handlers}
                    canEditModule={canEditModule}
                    showDepartment={access.canPublish}
                  />
                )}
              </>
            )}

            {!listLoading && (
              <>
                <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {programId
                    ? `${t("unattached")} · ${unattached.length}`
                    : `${t("modulesGroup")} · ${unattached.length}`}
                </p>
                {unattached.length === 0 ? (
                  <p className="px-2 py-3 text-[12px] text-muted-foreground">
                    {counts.total === 0 ? t("noModules") : t("allAttached")}
                  </p>
                ) : (
                  <CurriculumTree
                    modules={unattached}
                    access={access}
                    handlers={handlers}
                    canEditModule={canEditModule}
                    showDepartment={access.canPublish}
                  />
                )}
              </>
            )}
          </div>
        </aside>

        {/* ---------------- right: selected module ---------------- */}
        <section className="rounded-lg border bg-card">
          {selectedModule ? (
            <ModulePanel
              module={selectedModule}
              topics={topicRows}
              topicsLoading={selectedTopics.isLoading}
              access={access}
              programId={programId}
              programLinksReady={!!programId && !scoped.isLoading}
              attachedToProgram={attachedIds.has(selectedModule.id)}
              onEdit={() =>
                setModuleSheet({ open: true, module: selectedModule })
              }
              onSelectModule={(m) => setSelectedModuleId(m.id)}
            />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 px-8 py-16 text-center">
              <BookOpen className="size-8 text-muted-foreground/40" />
              <p className="text-[13px] font-medium">{t("emptySelection")}</p>
              <p className="max-w-sm text-[12px] leading-snug text-muted-foreground">
                {t("emptySelectionHint")}
              </p>
            </div>
          )}
        </section>
      </div>

      <ProgramSheet
        open={programSheet.open}
        onOpenChange={(v) => setProgramSheet((s) => ({ ...s, open: v }))}
        program={programSheet.program}
        onCreated={(p) => setProgramId(p.id)}
      />
      <ModuleSheet
        open={moduleSheet.open}
        onOpenChange={(v) => setModuleSheet((s) => ({ ...s, open: v }))}
        module={moduleSheet.module}
        access={access}
        programId={programId}
        onCreated={(m) => setSelectedModuleId(m.id)}
      />
      <TopicSheet
        open={topicSheet.open}
        onOpenChange={(v) => setTopicSheet((s) => ({ ...s, open: v }))}
        topic={topicSheet.topic}
        module={topicSheet.module}
        nextSort={topicSheet.nextSort}
        access={access}
      />
    </div>
  );
}
