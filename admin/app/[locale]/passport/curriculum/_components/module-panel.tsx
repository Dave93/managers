"use client";

// The right-hand panel: everything about the selected module that is not a
// text field — its lifecycle, and the honest answer to "can this go live yet".
//
// Every state-changing action here is irreversible-ish in a way the operator
// must understand BEFORE clicking, so each one goes through an AlertDialog
// that spells out the real-world consequence (стажёры увидят / перестанут
// видеть / прогресс сохранится). Buttons only appear when the backend would
// actually accept them:
//
//   submit-review  passport.curriculum.edit     draft only
//   publish        passport.curriculum.publish  draft|review
//   unpublish      passport.curriculum.publish  published only, and only while
//                                               nobody has progress — that last
//                                               part is NOT knowable in advance
//                                               (no endpoint exposes the count),
//                                               so the 409 is caught and turned
//                                               into the two live alternatives.
//   new-version    passport.curriculum.edit     published only
//   deactivate     passport.curriculum.publish  active modules
//   activate       passport.curriculum.publish  retired modules
//
// The 422 from publish is rendered as a LIST, in Russian, each line naming the
// topic it belongs to. Collapsing it into "что-то пошло не так" would throw
// away the only actionable thing on the screen.

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  CircleSlash,
  Copy,
  Link2Off,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
  Send,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/buttonOrigin";
import { Separator } from "@components/ui/separator";
import { cn } from "@admin/lib/utils";
import {
  activateModule,
  deactivateModule,
  deleteProgramModule,
  newModuleVersion,
  publishErrors,
  publishModule,
  refusalCode,
  submitModuleReview,
  unpublishModule,
  upsertProgramModule,
  type PassportModule,
  type PassportTopic,
} from "@admin/lib/passport-api";

import { moduleReadiness } from "./completeness";
import { issueLabel, translatePublishErrors, type PublishIssue } from "./publish-errors";
import { StatusChip } from "./status";
import {
  useApiMessage,
  moduleIsWritable,
  qk,
  type CurriculumAccess,
} from "./use-curriculum";


function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("passportUi.curriculum");
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[13px] leading-snug">
                {description}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                destructive &&
                  "bg-destructive text-white hover:bg-destructive/90"
              )}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ModulePanel({
  module: mod,
  topics,
  topicsLoading,
  access,
  programId,
  programLinksReady,
  attachedToProgram,
  onEdit,
  onSelectModule,
}: {
  module: PassportModule;
  topics: PassportTopic[];
  topicsLoading: boolean;
  access: CurriculumAccess;
  programId: string | null;
  /** False until the programme's module list has actually loaded — until then
   *  "is this module attached" is unknown, and offering either answer would
   *  flicker the wrong button. */
  programLinksReady: boolean;
  attachedToProgram: boolean;
  onEdit: () => void;
  onSelectModule: (m: PassportModule) => void;
}) {
  const t = useTranslations("passportUi.curriculum");
  const apiMessage = useApiMessage();
  const queryClient = useQueryClient();
  const [issues, setIssues] = useState<PublishIssue[] | null>(null);
  const [inUse, setInUse] = useState<{ rows: number } | null>(null);

  // A module's readiness is meaningless until its topics have loaded: with an
  // empty list the mirror correctly reports «нет активных тем», so a perfectly
  // ready module would flash "не готов" on every selection — and the publish
  // dialog would warn about blockers that do not exist.
  const topicsUnknown = topicsLoading && topics.length === 0;
  const readiness = moduleReadiness(t, mod, topics);
  const inScope = access.canPublish || mod.owner_department === access.department;
  // "Frozen" for the edit button's label: published, foreign department, or no
  // edit right — all three make the module Sheet read-only, so the button must
  // say so rather than promising an editor.
  const frozen = !moduleIsWritable(mod, access);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["passport_modules"] });
    queryClient.invalidateQueries({ queryKey: qk.topics(mod.id) });
  };

  // One useMutation per action: hooks cannot be created conditionally, and
  // each of these has a genuinely different success/error story anyway.
  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await submitModuleReview(mod.id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(t("panel.toastSubmitted"));
      refresh();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const { data, error } = await publishModule(mod.id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setIssues(null);
      toast.success(t("panel.toastPublished"));
      refresh();
    },
    onError: (error: any) => {
      const errs = publishErrors(error);
      if (errs) {
        setIssues(translatePublishErrors(t, errs, topics));
        toast.error(t("panel.toastPublishRejected"));
        return;
      }
      toast.error(apiMessage(error));
    },
  });

  const unpublish = useMutation({
    mutationFn: async () => {
      const { data, error } = await unpublishModule(mod.id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setInUse(null);
      toast.success(t("panel.toastUnpublished"));
      refresh();
    },
    onError: (error: any) => {
      if (refusalCode(error) === "module_in_use") {
        setInUse({ rows: Number(error?.value?.progress_rows ?? 0) });
        return;
      }
      toast.error(apiMessage(error));
    },
  });

  const fork = useMutation({
    mutationFn: async () => {
      const { data, error } = await newModuleVersion(mod.id);
      if (error) throw error;
      return data as PassportModule;
    },
    onSuccess: (created) => {
      setInUse(null);
      refresh();
      // Select the fork: otherwise the user stares at the still-published
      // original and concludes the button did nothing.
      onSelectModule(created);
      toast.success(t("panel.toastForked", { version: created.version }), {
        duration: 8000,
      });
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      const { data, error } = await deactivateModule(mod.id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setInUse(null);
      toast.success(t("panel.toastDeactivated"));
      refresh();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const activate = useMutation({
    mutationFn: async () => {
      const { data, error } = await activateModule(mod.id);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(t("panel.toastActivated"));
      refresh();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const attach = useMutation({
    mutationFn: async () => {
      const { data, error } = await upsertProgramModule({
        program_id: programId!,
        module_id: mod.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(t("panel.toastAttached"));
      refresh();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const detach = useMutation({
    mutationFn: async () => {
      const { data, error } = await deleteProgramModule({
        program_id: programId!,
        module_id: mod.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(t("panel.toastDetached"));
      refresh();
    },
    onError: (e: any) => {
      if (refusalCode(e) === "module_in_use_in_program") {
        toast.error(
          t("panel.toastDetachBlocked", {
            rows: e?.value?.progress_rows ?? "?",
          }),
          { duration: 9000 }
        );
        return;
      }
      toast.error(apiMessage(e));
    },
  });

  const bold = (c: ReactNode) => <b>{c}</b>;

  // Deactivation is offered from two places (the action bar and the
  // unpublish-refused block). The consequence text is defined once so the
  // second entry point can never turn into a bare, unconfirmed destructive
  // click.
  const deactivateTitle = t("panel.deactivateTitle");
  const deactivateConsequence = (
    <>
      <p>{t("panel.deactivateP1")}</p>
      <p>{t.rich("panel.deactivateP2", { b: bold })}</p>
    </>
  );

  const busy =
    submit.isPending ||
    publish.isPending ||
    unpublish.isPending ||
    fork.isPending ||
    deactivate.isPending ||
    activate.isPending ||
    attach.isPending ||
    detach.isPending;

  return (
    <div className="flex flex-col">
      {/* header */}
      <div className="space-y-2 border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              className={cn(
                "truncate text-base font-semibold",
                !mod.active && "text-muted-foreground line-through"
              )}
            >
              {mod.title_ru.trim() || t("panel.noTitle")}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {mod.title_uz.trim() || (
                <span className="text-amber-600 dark:text-amber-400">
                  {t("panel.noUzTitle")}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusChip status={mod.status} active={mod.active} />
            {mod.version > 1 && (
              <span className="rounded bg-muted px-1.5 py-px text-[11px] font-semibold text-muted-foreground">
                v{mod.version}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t("panel.department", { value: mod.owner_department })}</span>
          <span>
            {t("panel.brand", { value: mod.brand ?? t("panel.brandBoth") })}
          </span>
          <span>{t("panel.topicsCount", { count: readiness.total })}</span>
          {!inScope && (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {t("panel.foreignDepartment")}
            </span>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <Button
          size="sm"
          variant="outline"
          onClick={onEdit}
          disabled={busy}
        >
          {frozen ? (
            <Lock className="mr-1.5 size-3.5" />
          ) : (
            <Pencil className="mr-1.5 size-3.5" />
          )}
          {frozen ? t("panel.openReadonly") : t("panel.edit")}
        </Button>

        {access.canEdit && inScope && mod.status === "draft" && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <Send className="mr-1.5 size-3.5" /> {t("panel.submit")}
              </Button>
            }
            title={t("panel.submitTitle")}
            description={
              <>
                <p>{t("panel.submitP1")}</p>
                <p>{t("panel.submitP2")}</p>
              </>
            }
            confirmLabel={t("panel.submitConfirm")}
            onConfirm={() => submit.mutate()}
          />
        )}

        {access.canPublish && mod.status !== "published" && (
          <ConfirmAction
            trigger={
              <Button size="sm" disabled={busy}>
                <ArrowUpCircle className="mr-1.5 size-3.5" /> {t("panel.publish")}
              </Button>
            }
            title={t("panel.publishTitle")}
            description={
              <>
                <p>{t("panel.publishP1")}</p>
                <p>{t.rich("panel.publishP2", { b: bold })}</p>
                {!topicsUnknown && !readiness.ready && (
                  <p className="text-amber-700 dark:text-amber-400">
                    {t("panel.publishWarn")}
                  </p>
                )}
              </>
            }
            confirmLabel={t("panel.publish")}
            onConfirm={() => publish.mutate()}
          />
        )}

        {access.canPublish && mod.status === "published" && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <Undo2 className="mr-1.5 size-3.5" /> {t("panel.unpublish")}
              </Button>
            }
            title={t("panel.unpublishTitle")}
            description={
              <>
                <p>{t("panel.unpublishP1")}</p>
                <p>{t.rich("panel.unpublishP2", { b: bold })}</p>
              </>
            }
            confirmLabel={t("panel.unpublishConfirm")}
            onConfirm={() => unpublish.mutate()}
          />
        )}

        {access.canEdit && inScope && mod.status === "published" && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <Copy className="mr-1.5 size-3.5" /> {t("panel.newVersion")}
              </Button>
            }
            title={t("panel.forkTitle", { version: mod.version + 1 })}
            description={
              <>
                <p>{t("panel.forkP1")}</p>
                <p>{t.rich("panel.forkP2", { b: bold })}</p>
                <p>{t("panel.forkP3")}</p>
              </>
            }
            confirmLabel={t("panel.forkConfirm")}
            onConfirm={() => fork.mutate()}
          />
        )}

        {access.canPublish && mod.active && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <CircleSlash className="mr-1.5 size-3.5" /> {t("panel.deactivate")}
              </Button>
            }
            title={deactivateTitle}
            description={deactivateConsequence}
            confirmLabel={t("panel.deactivate")}
            destructive
            onConfirm={() => deactivate.mutate()}
          />
        )}

        {access.canPublish && !mod.active && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => activate.mutate()}
          >
            <RotateCcw className="mr-1.5 size-3.5" /> {t("panel.activate")}
          </Button>
        )}

        {access.canPublish && programLinksReady && !attachedToProgram && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => attach.mutate()}
          >
            {t("panel.attach")}
          </Button>
        )}

        {access.canPublish && programLinksReady && attachedToProgram && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="ghost" disabled={busy}>
                <Link2Off className="mr-1.5 size-3.5" /> {t("panel.detach")}
              </Button>
            }
            title={t("panel.detachTitle")}
            description={
              <>
                <p>{t("panel.detachP1")}</p>
                <p>{t("panel.detachP2")}</p>
              </>
            }
            confirmLabel={t("panel.detachConfirm")}
            destructive
            onConfirm={() => detach.mutate()}
          />
        )}

        {busy && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* readiness + errors */}
      <div className="space-y-4 px-5 py-4">
        {inUse && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-[13px] font-medium text-destructive">
              {inUse.rows
                ? t("panel.inUseRows", { rows: inUse.rows })
                : t("panel.inUse")}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t("panel.inUseHint")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {access.canEdit && inScope && (
                <Button size="sm" variant="outline" onClick={() => fork.mutate()}>
                  <Copy className="mr-1.5 size-3.5" /> {t("panel.createNewVersion")}
                </Button>
              )}
              {access.canPublish && mod.active && (
                <ConfirmAction
                  trigger={
                    <Button size="sm" variant="outline">
                      <CircleSlash className="mr-1.5 size-3.5" /> {t("panel.deactivate")}
                    </Button>
                  }
                  title={deactivateTitle}
                  description={deactivateConsequence}
                  confirmLabel={t("panel.deactivate")}
                  destructive
                  onConfirm={() => deactivate.mutate()}
                />
              )}
              <Button size="sm" variant="ghost" onClick={() => setInUse(null)}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        )}

        {issues && issues.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              <p className="text-[13px] font-medium text-destructive">
                {t("panel.rejected", { count: issues.length })}
              </p>
            </div>
            <ul className="mt-2 space-y-1.5">
              {issues.map((iss, i) => (
                <li key={i} className="text-[12.5px] leading-snug">
                  <span className="font-medium">{issueLabel(t, iss)}</span>
                  {": "}
                  <span className="text-muted-foreground">{iss.text}</span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setIssues(null)}
            >
              {t("panel.hide")}
            </Button>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2">
            {topicsUnknown ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : readiness.ready ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="size-4 text-amber-600" />
            )}
            <h3 className="text-[13px] font-semibold">
              {topicsUnknown
                ? t("panel.checking")
                : readiness.ready
                  ? t("panel.ready")
                  : t("panel.notReady")}
            </h3>
            {!topicsUnknown && topicsLoading && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t("panel.readinessNote")}
          </p>

          {!topicsUnknown && !readiness.ready && (
            <div className="mt-3 space-y-3">
              {readiness.moduleBlockers.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium">{t("panel.moduleHeading")}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
                    {readiness.moduleBlockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              {readiness.topicBlockers.map(({ topic, index, reasons }) => (
                <div key={topic.id}>
                  <p className="text-[12px] font-medium">
                    {topic.title_ru.trim()
                      ? t("panel.topicHeadingTitled", {
                          index,
                          title: topic.title_ru.trim(),
                        })
                      : t("panel.topicHeading", { index })}
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />
        <p className="text-[11px] text-muted-foreground">
          {t("panel.statusLine", {
            status: t(`status.${mod.status}`),
            retired: mod.active ? "no" : "yes",
            date: new Date(mod.updated_at).toLocaleString("ru-RU"),
          })}
        </p>
      </div>
    </div>
  );
}
