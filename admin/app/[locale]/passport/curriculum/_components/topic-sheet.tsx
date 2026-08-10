"use client";

// Topic editor — the TWI card: шаг / ключевой момент / почему так, each in RU
// and UZ-Latin, side by side. Four bilingual pairs, one verification type, and
// (for observation types) the checklist the mentor signs against.
//
// Two things this form is responsible for that the tree cannot do:
//  * warn about `dual` / `quiz_observation_photo` AT THE MOMENT OF CHOOSING —
//    those cannot be signed off in the current stage and the publish gate
//    refuses any module containing them, so finding out after a failed publish
//    is too late;
//  * show the topic's own publish blockers live, from the same mirror the tree
//    and the readiness panel use.
//
// The checklist arrays are held in plain React state rather than as
// @tanstack/react-form array fields: the value is one jsonb blob on the wire,
// and array-field wiring buys nothing here.

import { useEffect, useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { Switch } from "@components/ui/switch";
import { cn } from "@admin/lib/utils";
import {
  createTopic,
  updateTopic,
  type PassportModule,
  type PassportObservationChecklistItem,
  type PassportTopic,
  type PassportVerificationType,
} from "@admin/lib/passport-api";

import { BilingualPair } from "./bilingual-field";
import {
  UNSIGNABLE_WARNING,
  VERIFICATION_LABELS,
  hasObservation,
  hasQuiz,
  isUnsignable,
  topicBlockers,
} from "./completeness";
import {
  apiMessage,
  moduleIsWritable,
  qk,
  useTestOptions,
  type CurriculumAccess,
} from "./use-curriculum";

const NO_TEST = "__none__";

const VERIFICATION_ORDER: PassportVerificationType[] = [
  "quiz",
  "observation",
  "quiz_observation",
  "quiz_observation_photo",
  "dual",
];

type ChecklistRows = {
  items: PassportObservationChecklistItem[];
  questions: PassportObservationChecklistItem[];
};

function ChecklistEditor({
  title,
  hint,
  rows,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  rows: PassportObservationChecklistItem[];
  onChange: (next: PassportObservationChecklistItem[]) => void;
  disabled?: boolean;
}) {
  const set = (i: number, lang: "ru" | "uz", v: string) => {
    const next = rows.slice();
    next[i] = { ...next[i], [lang]: v };
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[13px] font-medium">{title}</Label>
        <span className="text-[11px] text-muted-foreground">{rows.length}</span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={row.ru ?? ""}
                disabled={disabled}
                placeholder="RU"
                onChange={(e) => set(i, "ru", e.target.value)}
              />
              <Input
                value={row.uz ?? ""}
                disabled={disabled}
                placeholder="UZ"
                onChange={(e) => set(i, "uz", e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label="Удалить строку"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { ru: "", uz: "" }])}
        >
          <Plus className="mr-1 size-3.5" /> Добавить
        </Button>
      )}
    </div>
  );
}

function TopicForm({
  topic,
  module: mod,
  nextSort,
  frozen,
  onClose,
}: {
  topic: PassportTopic | null;
  module: PassportModule;
  nextSort: number;
  frozen: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const tests = useTestOptions();

  const [checklist, setChecklist] = useState<ChecklistRows>({
    items: topic?.observation_checklist?.items ?? [],
    questions: topic?.observation_checklist?.questions ?? [],
  });

  const form = useForm({
    defaultValues: {
      title_ru: topic?.title_ru ?? "",
      title_uz: topic?.title_uz ?? "",
      step_ru: topic?.step_ru ?? "",
      step_uz: topic?.step_uz ?? "",
      key_point_ru: topic?.key_point_ru ?? "",
      key_point_uz: topic?.key_point_uz ?? "",
      reason_ru: topic?.reason_ru ?? "",
      reason_uz: topic?.reason_uz ?? "",
      verification_type: (topic?.verification_type ??
        "quiz_observation") as PassportVerificationType,
      quiz_test_id: topic?.quiz_test_id ?? null,
      active: topic?.active ?? true,
    },
    onSubmit: async ({ value }) => save.mutate(value),
  });

  useEffect(() => {
    setChecklist({
      items: topic?.observation_checklist?.items ?? [],
      questions: topic?.observation_checklist?.questions ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id]);

  const save = useMutation({
    mutationFn: async (v: any) => {
      const vt = v.verification_type as PassportVerificationType;
      // Only send a checklist for types that use one; sending {items:[]} on a
      // pure-quiz topic would leave dead data the publish validator ignores.
      const payload = {
        title_ru: v.title_ru,
        title_uz: v.title_uz,
        step_ru: v.step_ru,
        step_uz: v.step_uz,
        key_point_ru: v.key_point_ru,
        key_point_uz: v.key_point_uz,
        reason_ru: v.reason_ru,
        reason_uz: v.reason_uz,
        verification_type: vt,
        quiz_test_id: hasQuiz(vt) ? v.quiz_test_id : null,
        observation_checklist: hasObservation(vt)
          ? { items: checklist.items, questions: checklist.questions }
          : null,
        active: v.active,
      };
      const { data, error } = topic
        ? await updateTopic(topic.id, payload)
        : await createTopic({
            module_id: mod.id,
            sort: nextSort,
            ...payload,
          });
      if (error) throw new Error(apiMessage(error));
      return data as PassportTopic;
    },
    onSuccess: () => {
      toast.success(topic ? "Тема сохранена" : "Тема добавлена");
      queryClient.invalidateQueries({ queryKey: qk.topics(mod.id) });
      onClose();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-6 pb-4"
    >
      {frozen && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            Модуль опубликован — темы заморожены. Чтобы править содержание,
            создайте новую версию модуля.
          </span>
        </div>
      )}

      <BilingualPair
        form={form}
        label="Название темы"
        nameRu="title_ru"
        nameUz="title_uz"
        disabled={frozen}
      />
      <BilingualPair
        form={form}
        label="Шаг — что делаем"
        nameRu="step_ru"
        nameUz="step_uz"
        multiline
        rows={3}
        disabled={frozen}
        hint="Действие целиком, как его выполняет сотрудник."
      />
      <BilingualPair
        form={form}
        label="Ключевой момент — как именно"
        nameRu="key_point_ru"
        nameUz="key_point_uz"
        multiline
        rows={3}
        disabled={frozen}
        hint="То, без чего шаг будет сделан неправильно."
      />
      <BilingualPair
        form={form}
        label="Почему так"
        nameRu="reason_ru"
        nameUz="reason_uz"
        multiline
        rows={3}
        disabled={frozen}
        hint="Причина: качество, безопасность, скорость."
      />

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Тип проверки</Label>
        <form.Field name="verification_type">
          {(field: any) => {
            const vt = field.state.value as PassportVerificationType;
            return (
              <div className="space-y-2">
                <Select
                  disabled={frozen}
                  value={vt}
                  onValueChange={(v) => field.handleChange(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VERIFICATION_ORDER.map((v) => (
                      <SelectItem key={v} value={v}>
                        <span
                          className={cn(
                            isUnsignable(v) &&
                              "text-amber-700 dark:text-amber-400"
                          )}
                        >
                          {VERIFICATION_LABELS[v]}
                          {isUnsignable(v) && " — пока не поддерживается"}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isUnsignable(vt) && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>{UNSIGNABLE_WARNING}</span>
                  </div>
                )}
              </div>
            );
          }}
        </form.Field>
      </div>

      <form.Subscribe selector={(s: any) => s.values.verification_type}>
        {(vt: PassportVerificationType) => (
          <div className="space-y-6">
            {hasQuiz(vt) && (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Тест для квиза</Label>
                <form.Field name="quiz_test_id">
                  {(field: any) =>
                    tests.isError ? (
                      <div className="space-y-1">
                        <Input
                          value={field.state.value ?? ""}
                          disabled={frozen}
                          placeholder="UUID теста"
                          onChange={(e) =>
                            field.handleChange(e.target.value || null)
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Список тестов недоступен (нет права «tests.list») —
                          вставьте id теста вручную.
                        </p>
                      </div>
                    ) : (
                      <Select
                        disabled={frozen || tests.isLoading}
                        value={field.state.value ?? NO_TEST}
                        onValueChange={(v) =>
                          field.handleChange(v === NO_TEST ? null : v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Не выбран" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_TEST}>Не выбран</SelectItem>
                          {(tests.data ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  }
                </form.Field>
                <p className="text-[11px] text-muted-foreground">
                  Обязателен для всех типов, кроме «Наблюдение наставника».
                </p>
              </div>
            )}

            {hasObservation(vt) && !isUnsignable(vt) && (
              <div className="space-y-5 rounded-md border border-border/70 p-3">
                <ChecklistEditor
                  title="Чек-лист наблюдения"
                  hint="Что наставник отмечает галочками, наблюдая работу. Нужен хотя бы один пункт, иначе модуль не опубликуется."
                  rows={checklist.items}
                  disabled={frozen}
                  onChange={(items) => setChecklist((c) => ({ ...c, items }))}
                />
                <ChecklistEditor
                  title="Контрольные вопросы"
                  hint="Можно оставить пустыми, но сам блок обязателен — он сохраняется вместе с чек-листом."
                  rows={checklist.questions}
                  disabled={frozen}
                  onChange={(questions) =>
                    setChecklist((c) => ({ ...c, questions }))
                  }
                />
              </div>
            )}
          </div>
        )}
      </form.Subscribe>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
        <div>
          <Label className="text-[13px] font-medium">Тема активна</Label>
          <p className="text-[11px] text-muted-foreground">
            Неактивная тема остаётся в модуле, но не входит ни в выдачу
            стажёру, ни в проверку публикации.
          </p>
        </div>
        <form.Field name="active">
          {(field: any) => (
            <Switch
              checked={!!field.state.value}
              disabled={frozen}
              onCheckedChange={field.handleChange}
            />
          )}
        </form.Field>
      </div>

      <form.Subscribe selector={(s: any) => s.values}>
        {(values: any) => {
          const vt = values.verification_type as PassportVerificationType;
          const blockers = topicBlockers({
            ...values,
            observation_checklist: hasObservation(vt)
              ? { items: checklist.items, questions: checklist.questions }
              : null,
          });
          if (!blockers.length)
            return (
              <p className="text-[12px] text-emerald-700 dark:text-emerald-400">
                Тема заполнена — публикацию модуля она не блокирует.
              </p>
            );
          return (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="text-[12px] font-medium text-amber-900 dark:text-amber-200">
                Что в этой теме заблокирует публикацию модуля:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-amber-900/90 dark:text-amber-200/90">
                {blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          );
        }}
      </form.Subscribe>

      {!frozen && (
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {topic ? "Сохранить" : "Добавить тему"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function TopicSheet({
  open,
  onOpenChange,
  topic,
  module: mod,
  nextSort,
  access,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  topic: PassportTopic | null;
  module: PassportModule | null;
  nextSort: number;
  access: CurriculumAccess;
}) {
  // Frozen = published, or outside this editor's department, or no edit right.
  // moduleIsWritable() is the single place that rule lives.
  const frozen = useMemo(
    () => !mod || !moduleIsWritable(mod, access),
    [mod, access]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-8 sm:max-w-3xl">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle>{topic ? "Тема" : "Новая тема"}</SheetTitle>
          <SheetDescription>
            {mod ? mod.title_ru || "Модуль без названия" : ""} — русский и
            узбекская латиница заполняются парой.
          </SheetDescription>
        </SheetHeader>
        {open && mod && (
          <TopicForm
            topic={topic}
            module={mod}
            nextSort={nextSort}
            frozen={frozen}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
