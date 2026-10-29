"use client";

// Module editor. Sheet, not Dialog — the house pattern for every create/edit
// surface in this admin, and the right call here anyway: the tree stays
// readable behind it.
//
// A published module renders READ-ONLY. It is frozen server-side (every write
// 409s, controller.ts:107-110) so the form must not pretend otherwise; the way
// forward is «Новая версия» / «Снять с публикации» / «Деактивировать» on the
// module header, not this form.

import { useEffect, useMemo } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

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
import {
  createModule,
  updateModule,
  upsertProgramModule,
  type PassportModule,
} from "@admin/lib/passport-api";

import { BilingualPair } from "./bilingual-field";
import { StatusChip } from "./status";
import {
  useApiMessage,
  moduleIsWritable,
  useTestOptions,
  type CurriculumAccess,
} from "./use-curriculum";

const NO_BRAND = "__all__";
const NO_TEST = "__none__";

function ModuleForm({
  module: mod,
  access,
  programId,
  onClose,
  onCreated,
}: {
  module: PassportModule | null;
  access: CurriculumAccess;
  programId: string | null;
  onClose: () => void;
  onCreated: (m: PassportModule) => void;
}) {
  const t = useTranslations("passportUi.curriculum");
  const apiMessage = useApiMessage();
  const queryClient = useQueryClient();
  const tests = useTestOptions();
  // Read-only whenever the backend would refuse the write: published (409),
  // another department's module (403), or no curriculum.edit right at all.
  // Same predicate the tree and the topic editor use — this form must not be
  // the one place that disagrees and offers a Save button that 403s.
  const frozen = !!mod && !moduleIsWritable(mod, access);

  const form = useForm({
    defaultValues: {
      title_ru: mod?.title_ru ?? "",
      title_uz: mod?.title_uz ?? "",
      brand: mod?.brand ?? null,
      owner_department: mod?.owner_department ?? access.department ?? "",
      exam_test_id: mod?.exam_test_id ?? null,
    } as {
      title_ru: string;
      title_uz: string;
      brand: string | null;
      owner_department: string;
      exam_test_id: string | null;
    },
    onSubmit: async ({ value }) => {
      if (mod) update.mutate(value);
      else create.mutate(value);
    },
  });

  useEffect(() => {
    if (!mod) return;
    form.setFieldValue("title_ru", mod.title_ru ?? "");
    form.setFieldValue("title_uz", mod.title_uz ?? "");
    form.setFieldValue("brand", mod.brand ?? null);
    form.setFieldValue("owner_department", mod.owner_department ?? "");
    form.setFieldValue("exam_test_id", mod.exam_test_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod?.id]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["passport_modules"] });
  };

  const create = useMutation({
    mutationFn: async (v: any) => {
      const { data, error } = await createModule({
        title_ru: v.title_ru,
        title_uz: v.title_uz,
        brand: v.brand,
        // Only a curriculum admin may hand a module to another department;
        // for everyone else the backend takes users.department anyway.
        ...(access.canPublish && v.owner_department
          ? { owner_department: v.owner_department }
          : {}),
        exam_test_id: v.exam_test_id,
      });
      if (error) throw new Error(apiMessage(error));
      const created = data as PassportModule;
      // A module lives in a programme only through passport_program_modules.
      // Without this link it exists but appears in NO programme tree — the
      // silent "where did my module go" failure. Only HR may create the link
      // (curriculum.publish), so a department editor is told instead.
      if (programId && access.canPublish) {
        const link = await upsertProgramModule({
          program_id: programId,
          module_id: created.id,
        });
        if (link.error)
          toast.warning(
            t("moduleSheet.createdNotLinked", { message: apiMessage(link.error) })
          );
      }
      return created;
    },
    onSuccess: (created) => {
      if (programId && !access.canPublish)
        toast.info(t("moduleSheet.createdAskHr"));
      else toast.success(t("moduleSheet.created"));
      invalidate();
      onCreated(created);
      onClose();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const update = useMutation({
    mutationFn: async (v: any) => {
      const { data, error } = await updateModule(mod!.id, {
        title_ru: v.title_ru,
        title_uz: v.title_uz,
        brand: v.brand,
        ...(access.canPublish && v.owner_department
          ? { owner_department: v.owner_department }
          : {}),
        exam_test_id: v.exam_test_id,
      });
      if (error) throw new Error(apiMessage(error));
      return data as PassportModule;
    },
    onSuccess: () => {
      toast.success(t("moduleSheet.saved"));
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const busy = create.isPending || update.isPending;

  const testSelect = useMemo(() => {
    if (tests.isError)
      return (
        <form.Field name="exam_test_id">
          {(field: any) => (
            <div className="space-y-1">
              <Input
                value={field.state.value ?? ""}
                disabled={frozen}
                placeholder={t("common.testUuid")}
                onChange={(e) => field.handleChange(e.target.value || null)}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("moduleSheet.testsUnavailable")}
              </p>
            </div>
          )}
        </form.Field>
      );
    return (
      <form.Field name="exam_test_id">
        {(field: any) => (
          <Select
            disabled={frozen || tests.isLoading}
            value={field.state.value ?? NO_TEST}
            onValueChange={(v) => field.handleChange(v === NO_TEST ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("moduleSheet.noExam")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEST}>{t("moduleSheet.noExam")}</SelectItem>
              {(tests.data ?? []).map((test) => (
                <SelectItem key={test.id} value={test.id}>
                  {test.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </form.Field>
    );
  }, [tests.isError, tests.isLoading, tests.data, frozen, form, t]);

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
            {t("moduleSheet.frozen")}
          </span>
        </div>
      )}

      <BilingualPair
        form={form}
        label={t("moduleSheet.titleLabel")}
        nameRu="title_ru"
        nameUz="title_uz"
        disabled={frozen}
        hint={t("moduleSheet.titleHint")}
        placeholderRu={t("moduleSheet.titlePlaceholderRu")}
        placeholderUz="Masalan: Xamir va tayyorgarlik"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-[13px] font-medium">{t("moduleSheet.brand")}</Label>
          <form.Field name="brand">
            {(field: any) => (
              <Select
                disabled={frozen}
                value={field.state.value ?? NO_BRAND}
                onValueChange={(v) =>
                  field.handleChange(v === NO_BRAND ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BRAND}>{t("moduleSheet.bothBrands")}</SelectItem>
                  <SelectItem value="chopar">Chopar Pizza</SelectItem>
                  <SelectItem value="les">Les Ailes</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </div>

        <div className="space-y-2">
          <Label className="text-[13px] font-medium">{t("moduleSheet.ownerDepartment")}</Label>
          <form.Field name="owner_department">
            {(field: any) => (
              <Input
                value={field.state.value ?? ""}
                disabled={frozen || !access.canPublish}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            )}
          </form.Field>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {access.canPublish
              ? t("moduleSheet.ownerHintHr")
              : t("moduleSheet.ownerHintLocked")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">{t("moduleSheet.exam")}</Label>
        {testSelect}
      </div>

      {!frozen && (
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {mod ? t("common.save") : t("moduleSheet.createModule")}
          </Button>
        </div>
      )}
    </form>
  );
}

export function ModuleSheet({
  open,
  onOpenChange,
  module: mod,
  access,
  programId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  module: PassportModule | null;
  access: CurriculumAccess;
  programId: string | null;
  onCreated: (m: PassportModule) => void;
}) {
  const t = useTranslations("passportUi.curriculum");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-8 sm:max-w-2xl">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle className="flex items-center gap-2">
            {mod ? t("moduleSheet.titleExisting") : t("moduleSheet.titleNew")}
            {mod && <StatusChip status={mod.status} active={mod.active} />}
          </SheetTitle>
          <SheetDescription>
            {t("moduleSheet.description")}
          </SheetDescription>
        </SheetHeader>
        {open && (
          <ModuleForm
            module={mod}
            access={access}
            programId={programId}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
