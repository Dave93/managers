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
import { MODULE_STATUS_LABEL, StatusChip } from "./status";
import {
  apiMessage,
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
            <AlertDialogCancel>Отмена</AlertDialogCancel>
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
  const queryClient = useQueryClient();
  const [issues, setIssues] = useState<PublishIssue[] | null>(null);
  const [inUse, setInUse] = useState<{ rows: number } | null>(null);

  const readiness = moduleReadiness(mod, topics);
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
      toast.success("Модуль отправлен на проверку");
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
      toast.success("Модуль опубликован и доступен стажёрам");
      refresh();
    },
    onError: (error: any) => {
      const errs = publishErrors(error);
      if (errs) {
        setIssues(translatePublishErrors(errs, topics));
        toast.error("Публикация отклонена — смотрите список ниже");
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
      toast.success("Модуль снят с публикации и снова редактируется");
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
      toast.success(
        `Создана версия v${created.version}. Она ещё не привязана ни к одной программе — привяжите её, когда будете готовы заменить текущую.`,
        { duration: 8000 }
      );
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
      toast.success("Модуль снят с обращения");
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
      toast.success("Модуль возвращён в обращение");
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
      toast.success("Модуль привязан к программе");
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
      toast.success("Модуль отвязан от программы");
      refresh();
    },
    onError: (e: any) => {
      if (refusalCode(e) === "module_in_use_in_program") {
        toast.error(
          `Отвязать нельзя: у стажёров этой программы уже есть прогресс по модулю (${
            e?.value?.progress_rows ?? "?"
          } записей). Деактивируйте модуль вместо отвязки.`,
          { duration: 9000 }
        );
        return;
      }
      toast.error(apiMessage(e));
    },
  });

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
              {mod.title_ru.trim() || "Модуль без названия"}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {mod.title_uz.trim() || (
                <span className="text-amber-600 dark:text-amber-400">
                  нет узбекского названия
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
          <span>Департамент: {mod.owner_department}</span>
          <span>Бренд: {mod.brand ?? "оба"}</span>
          <span>Тем: {readiness.total}</span>
          {!inScope && (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              чужой департамент — только просмотр
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
          {frozen ? "Открыть (только чтение)" : "Редактировать"}
        </Button>

        {access.canEdit && inScope && mod.status === "draft" && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <Send className="mr-1.5 size-3.5" /> На проверку
              </Button>
            }
            title="Отправить модуль на проверку?"
            description={
              <>
                <p>
                  Модуль перейдёт в статус «На проверке» и попадёт к HR. Стажёры
                  его пока не увидят.
                </p>
                <p>Содержание при этом остаётся редактируемым.</p>
              </>
            }
            confirmLabel="Отправить"
            onConfirm={() => submit.mutate()}
          />
        )}

        {access.canPublish && mod.status !== "published" && (
          <ConfirmAction
            trigger={
              <Button size="sm" disabled={busy}>
                <ArrowUpCircle className="mr-1.5 size-3.5" /> Опубликовать
              </Button>
            }
            title="Опубликовать модуль?"
            description={
              <>
                <p>
                  Модуль сразу станет доступен стажёрам всех программ, к которым
                  он привязан, и вернётся в обращение, даже если был снят.
                </p>
                <p>
                  После публикации модуль <b>замораживается</b>: править темы и
                  тексты напрямую больше нельзя — только «Новая версия» или
                  снятие с публикации (пока по нему нет прогресса).
                </p>
                {!readiness.ready && (
                  <p className="text-amber-700 dark:text-amber-400">
                    Проверка уже сейчас показывает незакрытые пункты — публикация
                    скорее всего будет отклонена.
                  </p>
                )}
              </>
            }
            confirmLabel="Опубликовать"
            onConfirm={() => publish.mutate()}
          />
        )}

        {access.canPublish && mod.status === "published" && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <Undo2 className="mr-1.5 size-3.5" /> Снять с публикации
              </Button>
            }
            title="Снять модуль с публикации?"
            description={
              <>
                <p>
                  Модуль вернётся в «Черновик» и снова станет редактируемым.
                  Номер версии не изменится.
                </p>
                <p>
                  Это возможно, только пока <b>ни один стажёр</b> не начал
                  проходить модуль. Если прогресс уже есть, система откажет —
                  тогда доступны «Новая версия» и «Деактивировать».
                </p>
              </>
            }
            confirmLabel="Снять"
            onConfirm={() => unpublish.mutate()}
          />
        )}

        {access.canEdit && inScope && mod.status === "published" && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <Copy className="mr-1.5 size-3.5" /> Новая версия
              </Button>
            }
            title={`Создать версию v${mod.version + 1}?`}
            description={
              <>
                <p>
                  Будет создан черновик-копия модуля со всеми темами. Стажёры
                  его не увидят, пока он не опубликован.
                </p>
                <p>
                  Текущая опубликованная версия <b>остаётся в работе</b> и
                  продолжает выдаваться стажёрам, пока вы её не деактивируете.
                </p>
                <p>
                  Копия не привязана ни к одной программе — привяжите её, когда
                  будете готовы к замене.
                </p>
              </>
            }
            confirmLabel="Создать версию"
            onConfirm={() => fork.mutate()}
          />
        )}

        {access.canPublish && mod.active && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="outline" disabled={busy}>
                <CircleSlash className="mr-1.5 size-3.5" /> Деактивировать
              </Button>
            }
            title="Снять модуль с обращения?"
            description={
              <>
                <p>
                  Модуль пропадёт из выдачи стажёрам и из списка модулей по
                  умолчанию.
                </p>
                <p>
                  Весь прогресс, подписи и стажировки <b>сохранятся</b> — это
                  мягкое снятие, а не удаление. Вернуть можно кнопкой «Вернуть в
                  обращение» (включите «Показывать снятые с обращения», чтобы
                  его найти).
                </p>
              </>
            }
            confirmLabel="Деактивировать"
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
            <RotateCcw className="mr-1.5 size-3.5" /> Вернуть в обращение
          </Button>
        )}

        {access.canPublish && programLinksReady && !attachedToProgram && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => attach.mutate()}
          >
            Привязать к программе
          </Button>
        )}

        {access.canPublish && programLinksReady && attachedToProgram && (
          <ConfirmAction
            trigger={
              <Button size="sm" variant="ghost" disabled={busy}>
                <Link2Off className="mr-1.5 size-3.5" /> Отвязать от программы
              </Button>
            }
            title="Отвязать модуль от программы?"
            description={
              <>
                <p>
                  Модуль исчезнет из этой программы, но останется в системе и в
                  других программах.
                </p>
                <p>
                  Если у стажёров этой программы уже есть прогресс по модулю,
                  система откажет — используйте деактивацию.
                </p>
              </>
            }
            confirmLabel="Отвязать"
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
              Снять с публикации нельзя: стажёры уже работают с модулем
              {inUse.rows ? ` (записей прогресса: ${inUse.rows})` : ""}.
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Их путь нельзя обрывать задним числом. Доступные варианты:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {access.canEdit && inScope && (
                <Button size="sm" variant="outline" onClick={() => fork.mutate()}>
                  <Copy className="mr-1.5 size-3.5" /> Создать новую версию
                </Button>
              )}
              {access.canPublish && mod.active && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deactivate.mutate()}
                >
                  <CircleSlash className="mr-1.5 size-3.5" /> Деактивировать
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setInUse(null)}>
                Закрыть
              </Button>
            </div>
          </div>
        )}

        {issues && issues.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              <p className="text-[13px] font-medium text-destructive">
                Публикация отклонена — {issues.length}{" "}
                {issues.length === 1 ? "причина" : "причин(ы)"}
              </p>
            </div>
            <ul className="mt-2 space-y-1.5">
              {issues.map((iss, i) => (
                <li key={i} className="text-[12.5px] leading-snug">
                  <span className="font-medium">{issueLabel(iss)}</span>
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
              Скрыть
            </Button>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2">
            {readiness.ready ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="size-4 text-amber-600" />
            )}
            <h3 className="text-[13px] font-semibold">
              {readiness.ready
                ? "Готов к публикации"
                : "Не готов к публикации"}
            </h3>
            {topicsLoading && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Проверка повторяет серверный гейт: обе языковые версии всех полей,
            хотя бы одна активная тема, тест для квиза, чек-лист для наблюдения
            и подписываемый тип проверки.
          </p>

          {!readiness.ready && (
            <div className="mt-3 space-y-3">
              {readiness.moduleBlockers.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium">Модуль</p>
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
                    Тема {index}
                    {topic.title_ru.trim() ? ` «${topic.title_ru.trim()}»` : ""}
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
          Статус: {MODULE_STATUS_LABEL[mod.status]}
          {!mod.active && " · снят с обращения"} · обновлён{" "}
          {new Date(mod.updated_at).toLocaleString("ru-RU")}
        </p>
      </div>
    </div>
  );
}
