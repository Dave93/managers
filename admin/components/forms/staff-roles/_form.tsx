import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  NONE,
  STAFF_ROLE_GROUPS,
  staffRolesApi,
  useStaffRoles,
  type StaffRole,
} from "@admin/lib/staff-roles";

export default function StaffRoleForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const t = useTranslations("staffRoles");
  const queryClient = useQueryClient();

  const onDone = (msg: string) => {
    toast.success(msg);
    queryClient.invalidateQueries({ queryKey: ["staff_roles"] });
    setOpen(false);
  };
  const onError = (e: any) => toast.error(e.message);

  const createMutation = useMutation({
    mutationFn: (data: any) => staffRolesApi.create(data),
    onSuccess: () => onDone(t("added")),
    onError,
  });
  const updateMutation = useMutation({
    mutationFn: (p: { data: any; id: string }) =>
      staffRolesApi.update(p.id, p.data),
    onSuccess: () => onDone(t("updated")),
    onError,
  });

  const { data: allRoles } = useStaffRoles({ activeOnly: false });

  const form = useForm({
    defaultValues: {
      code: "",
      name_ru: "",
      name_uz: "",
      group_key: "kitchen",
      is_trainee: false,
      trainee_of_code: NONE,
      sort: "0",
      active: true,
    },
    onSubmit: async ({ value }) => {
      const v = value as any;
      // Стажёрская роль без указания, кем человек станет, — тупик: перевести
      // его в штат будет некуда. Сервер это же и проверяет, здесь просто
      // раньше и понятнее.
      if (v.is_trainee && (!v.trainee_of_code || v.trainee_of_code === NONE)) {
        toast.error(t("errors.traineeOfRequired"));
        return;
      }
      const data: any = {
        name_ru: v.name_ru.trim(),
        name_uz: v.name_uz.trim(),
        group_key: v.group_key,
        is_trainee: v.is_trainee,
        trainee_of_code:
          v.is_trainee && v.trainee_of_code !== NONE ? v.trainee_of_code : null,
        sort: Number(v.sort) || 0,
        active: v.active,
      };
      if (recordId) {
        // code через PUT не идёт вовсе: это ключ засева и ключ, по которому
        // стажёрская роль ссылается на «взрослую».
        updateMutation.mutate({ data, id: recordId });
      } else {
        const code = v.code.trim();
        if (!/^[a-z0-9_]{2,50}$/.test(code)) {
          toast.error(t("errors.codeFormat"));
          return;
        }
        createMutation.mutate({ ...data, code });
      }
    },
  });

  const { data: record } = useQuery({
    queryKey: ["one_staff_role", recordId],
    queryFn: () => (recordId ? staffRolesApi.one(recordId) : null),
    enabled: !!recordId,
  });

  useEffect(() => {
    const r = record as StaffRole | null | undefined;
    if (r && r.id) {
      form.setFieldValue("code", r.code ?? "");
      form.setFieldValue("name_ru", r.name_ru ?? "");
      form.setFieldValue("name_uz", r.name_uz ?? "");
      form.setFieldValue("group_key", r.group_key ?? "kitchen");
      form.setFieldValue("is_trainee", r.is_trainee ?? false);
      form.setFieldValue("trainee_of_code", r.trainee_of_code ?? NONE);
      form.setFieldValue("sort", String(r.sort ?? 0));
      form.setFieldValue("active", r.active ?? true);
    }
  }, [record]);

  const isLoading = useMemo(
    () => createMutation.isPending || updateMutation.isPending,
    [createMutation.isPending, updateMutation.isPending]
  );

  // Учиться можно только на нестажёрскую роль.
  const targetRoles = (allRoles ?? []).filter(
    (r) => !r.is_trainee && r.code !== (record as any)?.code
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <Label>{t("fields.code")}</Label>
        <form.Field name="code">
          {(field) => (
            <Input
              value={field.state.value}
              disabled={!!recordId}
              placeholder="kitchen_worker"
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <p className="text-xs text-muted-foreground">
          {recordId ? t("fields.codeLocked") : t("fields.codeHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("fields.nameRu")}</Label>
        <form.Field name="name_ru">
          {(field) => (
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <p className="text-xs text-muted-foreground">{t("fields.nameRuHint")}</p>
      </div>

      <div className="space-y-2">
        <Label>{t("fields.nameUz")}</Label>
        <form.Field name="name_uz">
          {(field) => (
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      </div>

      <div className="space-y-2">
        <Label>{t("fields.group")}</Label>
        <form.Field name="group_key">
          {(field) => (
            <Select
              value={field.state.value}
              onValueChange={field.handleChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAFF_ROLE_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {t(`groups.${g}` as any)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      </div>

      <div className="space-y-2">
        <Label>{t("fields.sort")}</Label>
        <form.Field name="sort">
          {(field) => (
            <Input
              type="number"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <p className="text-xs text-muted-foreground">{t("fields.sortHint")}</p>
      </div>

      <div className="flex items-center justify-between">
        <Label>{t("fields.isTrainee")}</Label>
        <form.Field name="is_trainee">
          {(field) => (
            <Switch
              checked={field.getValue()}
              onCheckedChange={field.setValue}
            />
          )}
        </form.Field>
      </div>

      <form.Subscribe selector={(s: any) => s.values.is_trainee}>
        {(isTrainee: boolean) =>
          isTrainee ? (
            <div className="space-y-2">
              <Label>{t("fields.traineeOf")}</Label>
              <form.Field name="trainee_of_code">
                {(field) => (
                  <Select
                    value={field.state.value}
                    onValueChange={field.handleChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("fields.traineeOf")} />
                    </SelectTrigger>
                    <SelectContent>
                      {targetRoles.map((r) => (
                        <SelectItem key={r.id} value={r.code}>
                          {r.name_ru}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>
              <p className="text-xs text-muted-foreground">
                {t("fields.traineeOfHint")}
              </p>
            </div>
          ) : null
        }
      </form.Subscribe>

      <div className="flex items-center justify-between">
        <Label>{t("fields.active")}</Label>
        <form.Field name="active">
          {(field) => (
            <Switch
              checked={field.getValue()}
              onCheckedChange={field.setValue}
            />
          )}
        </form.Field>
      </div>

      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("submit")}
      </Button>
    </form>
  );
}
