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
import { apiClient } from "@admin/utils/eden";
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";

export default function AttestationEmployeeForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const t = useTranslations("attestation");
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

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.api.attestation.employees.post({ data }),
    onSuccess: () => onDone(t("employees.added")),
    onError,
  });
  const updateMutation = useMutation({
    mutationFn: (p: { data: any; id: string }) =>
      apiClient.api.attestation.employees({ id: p.id }).put({ data: p.data }),
    onSuccess: () => onDone(t("employees.updated")),
    onError,
  });

  const form = useForm({
    defaultValues: {
      first_name: "",
      last_name: "",
      position: "",
      terminal_id: "",
      active: true,
    },
    onSubmit: async ({ value }) => {
      if (recordId) updateMutation.mutate({ data: value, id: recordId });
      else createMutation.mutate(value);
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
      form.setFieldValue("position", r.position ?? "");
      form.setFieldValue("terminal_id", r.terminal_id ?? "");
      form.setFieldValue("active", r.active ?? true);
    }
  }, [record]);

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
      {textField("position", t("employees.position"))}

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
