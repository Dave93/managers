import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { DatePickerField } from "@admin/components/ui/date-picker-field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  NONE,
  composePositionPreview,
  groupRoles,
  roleLabel,
  unwrapEden,
  useStaffRoles,
  type StaffRole,
} from "@admin/lib/staff-roles";

export default function AttestationEmployeeForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const t = useTranslations("attestation");
  const tMedical = useTranslations("medical");
  const locale = useLocale();
  const queryClient = useQueryClient();

  const onDone = (msg: string) => {
    toast.success(msg);
    queryClient.invalidateQueries({ queryKey: ["attestation_employees"] });
    setOpen(false);
  };
  const onError = (e: any) => toast.error(e.message);

  const { data: terminals } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: () => apiClient.api.terminals.cached.get(),
  });

  // Eden отдаёт `{ data, error }` и не бросает на 4xx. Без unwrapEden форма
  // показывала бы «сотрудник добавлен» и на 422 «Unknown staff_role_id».
  const createMutation = useMutation({
    mutationFn: async (data: any) =>
      unwrapEden(await apiClient.api.attestation.employees.post({ data })),
    onSuccess: () => onDone(t("employees.added")),
    onError,
  });
  const updateMutation = useMutation({
    mutationFn: async (p: { data: any; id: string }) =>
      unwrapEden(
        await apiClient.api.attestation.employees({ id: p.id }).put({ data: p.data })
      ),
    onSuccess: () => onDone(t("employees.updated")),
    onError,
  });

  // Справочник целиком, включая деактивированные: если сотрудник числится на
  // роли, которую HR уже отключил, список активных её не содержит и Select
  // молча показал бы пустое поле. Такую роль оставляем видимой и помечаем.
  const { data: allRoles } = useStaffRoles({ activeOnly: false });

  const form = useForm({
    defaultValues: {
      first_name: "",
      last_name: "",
      staff_role_id: "",
      grade: NONE,
      shift: NONE,
      terminal_id: "",
      active: true,
      medical_start_date: "",
    },
    onSubmit: async ({ value }) => {
      const v = value as any;
      // Должность перестала быть свободной строкой: без роли серверу нечего
      // собирать, и запись уехала бы с пустым position.
      if (!v.staff_role_id) {
        toast.error(t("employees.roleRequired"));
        return;
      }
      // position не шлём вовсе — его собирает сервер по шаблону
      // «Роль[ N разряд][ смена]». Сентинел «не указано» разворачивается в
      // null: у охраны и няни смены нет, у трети людей нет разряда, и это
      // законное состояние, а не незаполненное поле. grade приезжает из
      // Select строкой, колонка в базе целочисленная.
      const data = {
        first_name: v.first_name,
        last_name: v.last_name,
        terminal_id: v.terminal_id,
        active: v.active,
        staff_role_id: v.staff_role_id,
        grade: v.grade === NONE ? null : Number(v.grade),
        shift: v.shift === NONE ? null : v.shift,
      };
      if (recordId) {
        updateMutation.mutate({ data, id: recordId });
      } else {
        createMutation.mutate(
          v.medical_start_date
            ? { ...data, medical_start_date: v.medical_start_date }
            : data
        );
      }
    },
  });

  const { data: record } = useQuery({
    queryKey: ["one_attestation_employee", recordId],
    queryFn: () =>
      recordId
        ? apiClient.api.attestation.employees({ id: recordId }).get({})
        : null,
    enabled: !!recordId,
  });

  useEffect(() => {
    if (record?.data && "id" in record.data) {
      const r = record.data as any;
      form.setFieldValue("first_name", r.first_name ?? "");
      form.setFieldValue("last_name", r.last_name ?? "");
      form.setFieldValue("staff_role_id", r.staff_role_id ?? "");
      form.setFieldValue("grade", r.grade == null ? NONE : String(r.grade));
      form.setFieldValue("shift", r.shift ?? NONE);
      form.setFieldValue("terminal_id", r.terminal_id ?? "");
      form.setFieldValue("active", r.active ?? true);
    }
  }, [record]);

  const roleOptions = useMemo<StaffRole[]>(() => {
    const list = allRoles ?? [];
    const currentId = (record?.data as any)?.staff_role_id ?? null;
    return list.filter((r) => r.active || r.id === currentId);
  }, [allRoles, record]);

  const groupLabel = (g: string) =>
    ["kitchen", "front", "management", "other"].includes(g)
      ? t(`employees.groups.${g}` as any)
      : g;

  const isLoading = useMemo(
    () => createMutation.isPending || updateMutation.isPending,
    [createMutation.isPending, updateMutation.isPending]
  );

  const textField = (name: string, label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <form.Field name={name as any}>
        {(field: any) => (
          <Input
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
          />
        )}
      </form.Field>
    </div>
  );

  const terminalList = (terminals as any)?.data ?? terminals ?? [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-6"
    >
      {textField("first_name", t("employees.firstName"))}
      {textField("last_name", t("employees.lastName"))}
      <div className="space-y-2">
        <Label>{t("employees.role")}</Label>
        <form.Field name={"staff_role_id" as any}>
          {(field: any) => (
            <Select
              value={field.state.value || undefined}
              onValueChange={field.handleChange}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("employees.selectRole")} />
              </SelectTrigger>
              <SelectContent>
                {groupRoles(roleOptions).map(({ group, roles }) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{groupLabel(group)}</SelectLabel>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        <span>{roleLabel(r, locale)}</span>
                        {r.is_trainee ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t("employees.traineeMark")}
                          </span>
                        ) : null}
                        {!r.active ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t("employees.roleInactive")}
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      </div>

      {/* Разряд и смена осмысленны не для всех: у охраны и няни смены нет,
          у трети людей нет разряда. Поэтому подписи приглушены, а «не указано»
          — выбираемое значение, а не только начальное состояние. */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="font-normal text-muted-foreground">
            {t("employees.grade")}
          </Label>
          <form.Field name={"grade" as any}>
            {(field: any) => (
              <Select
                value={field.state.value}
                onValueChange={field.handleChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("employees.notSpecified")}
                  </SelectItem>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <Label className="font-normal text-muted-foreground">
            {t("employees.shift")}
          </Label>
          <form.Field name={"shift" as any}>
            {(field: any) => (
              <Select
                value={field.state.value}
                onValueChange={field.handleChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("employees.notSpecified")}
                  </SelectItem>
                  <SelectItem value="day">{t("employees.shiftDay")}</SelectItem>
                  <SelectItem value="night">
                    {t("employees.shiftNight")}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </div>
      </div>

      {/* Человек привык видеть должность текстом, и эта же строка ляжет в
          employees.position. Собирается по тому же шаблону, что на сервере,
          и всегда из name_ru — сервер другого названия не знает. */}
      <form.Subscribe selector={(s: any) => s.values}>
        {(values: any) => {
          const role = roleOptions.find((r) => r.id === values.staff_role_id);
          const preview = composePositionPreview(
            role,
            values.grade === NONE ? null : Number(values.grade),
            values.shift === NONE ? null : values.shift
          );
          return (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {t("employees.positionPreview")}:{" "}
              </span>
              <span className="font-medium">
                {preview || t("employees.positionPreviewEmpty")}
              </span>
            </div>
          );
        }}
      </form.Subscribe>

      <div className="space-y-2">
        <Label>{t("employees.terminal")}</Label>
        <form.Field name="terminal_id">
          {(field) => (
            <Select value={field.state.value} onValueChange={field.handleChange}>
              <SelectTrigger>
                <SelectValue placeholder={t("employees.selectTerminal")} />
              </SelectTrigger>
              <SelectContent>
                {terminalList.map((term: any) => (
                  <SelectItem key={term.id} value={term.id}>
                    {term.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      </div>

      {!recordId && (
        <div className="space-y-2">
          <Label>{tMedical("employeeForm.medicalStartDate")}</Label>
          <form.Field name={"medical_start_date" as any}>
            {(field: any) => (
              <DatePickerField
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
              />
            )}
          </form.Field>
        </div>
      )}

      <div className="space-y-2">
        <Label>{t("employees.active")}</Label>
        <div>
          <form.Field name="active">
            {(field) => (
              <Switch
                checked={field.getValue()}
                onCheckedChange={field.setValue}
              />
            )}
          </form.Field>
        </div>
      </div>

      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("common.submit")}
      </Button>
    </form>
  );
}
