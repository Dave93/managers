"use client";

// Programme editor. A programme is "the training path of one job" — position
// plus a bilingual title — and it is the root the whole tree hangs from, so
// the builder needs to be able to create one without leaving the screen.
// HR only (POST/PUT /passport/programs are gated on
// passport.curriculum.publish).

import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { Switch } from "@components/ui/switch";
import {
  createProgram,
  updateProgram,
  type PassportProgram,
} from "@admin/lib/passport-api";

import { BilingualPair } from "./bilingual-field";
import { qk, useApiMessage } from "./use-curriculum";

function ProgramForm({
  program,
  onClose,
  onCreated,
}: {
  program: PassportProgram | null;
  onClose: () => void;
  onCreated: (p: PassportProgram) => void;
}) {
  const t = useTranslations("passportUi.curriculum");
  const apiMessage = useApiMessage();
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: {
      position: program?.position ?? "",
      title_ru: program?.title_ru ?? "",
      title_uz: program?.title_uz ?? "",
      active: program?.active ?? true,
    },
    onSubmit: async ({ value }) => save.mutate(value),
  });

  useEffect(() => {
    if (!program) return;
    form.setFieldValue("position", program.position ?? "");
    form.setFieldValue("title_ru", program.title_ru ?? "");
    form.setFieldValue("title_uz", program.title_uz ?? "");
    form.setFieldValue("active", program.active ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program?.id]);

  const save = useMutation({
    mutationFn: async (v: any) => {
      const { data, error } = program
        ? await updateProgram(program.id, v)
        : await createProgram(v);
      if (error) throw new Error(apiMessage(error));
      return data as PassportProgram;
    },
    onSuccess: (p) => {
      toast.success(
        program ? t("programSheet.saved") : t("programSheet.created")
      );
      queryClient.invalidateQueries({ queryKey: qk.programs });
      if (!program) onCreated(p);
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
      <div className="space-y-2">
        <Label className="text-[13px] font-medium">{t("programSheet.position")}</Label>
        <form.Field name="position">
          {(field: any) => (
            <Input
              value={field.state.value ?? ""}
              placeholder="Повар, Кассир, Менеджер смены…"
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <p className="text-[11px] text-muted-foreground">
          {t("programSheet.positionHint")}
        </p>
      </div>

      <BilingualPair
        form={form}
        label={t("programSheet.titleLabel")}
        nameRu="title_ru"
        nameUz="title_uz"
      />

      <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
        <div>
          <Label className="text-[13px] font-medium">{t("programSheet.active")}</Label>
          <p className="text-[11px] text-muted-foreground">
            {t("programSheet.activeHint")}
          </p>
        </div>
        <form.Field name="active">
          {(field: any) => (
            <Switch
              checked={!!field.state.value}
              onCheckedChange={field.handleChange}
            />
          )}
        </form.Field>
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          {program ? t("common.save") : t("programSheet.create")}
        </Button>
      </div>
    </form>
  );
}

export function ProgramSheet({
  open,
  onOpenChange,
  program,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  program: PassportProgram | null;
  onCreated: (p: PassportProgram) => void;
}) {
  const t = useTranslations("passportUi.curriculum");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-8 sm:max-w-xl">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle>
            {program ? t("programSheet.titleExisting") : t("programSheet.titleNew")}
          </SheetTitle>
          <SheetDescription>
            {t("programSheet.description")}
          </SheetDescription>
        </SheetHeader>
        {open && (
          <ProgramForm
            program={program}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
