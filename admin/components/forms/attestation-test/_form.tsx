import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { attestation_tests } from "@backend/../drizzle/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";

export default function AttestationTestForm({
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
    queryClient.invalidateQueries({ queryKey: ["attestation_tests"] });
    setOpen(false);
  };
  const onError = (e: any) => toast.error(e.message);

  const createMutation = useMutation({
    mutationFn: (data: typeof attestation_tests.$inferInsert) =>
      apiClient.api.attestation.tests.post({ data }),
    onSuccess: () => onDone(t("tests.added")),
    onError,
  });
  const updateMutation = useMutation({
    mutationFn: (p: { data: typeof attestation_tests.$inferInsert; id: string }) =>
      apiClient.api.attestation.tests({ id: p.id }).put({ data: p.data }),
    onSuccess: () => onDone(t("tests.updated")),
    onError,
  });

  const form = useForm({
    defaultValues: {
      title: "",
      description: "",
      passing_score: 80,
      time_limit_minutes: 15,
      questions_per_attempt: 10,
      shuffle_questions: true,
      shuffle_options: true,
      valid_months: 12,
      active: true,
    },
    onSubmit: async ({ value }) => {
      if (recordId) updateMutation.mutate({ data: value as any, id: recordId });
      else createMutation.mutate(value as any);
    },
  });

  const { data: record } = useQuery({
    queryKey: ["one_attestation_test", recordId],
    queryFn: () =>
      recordId ? apiClient.api.attestation.tests({ id: recordId }).get({}) : null,
    enabled: !!recordId,
  });

  useEffect(() => {
    if (record?.data && "id" in record.data) {
      const r = record.data as any;
      form.setFieldValue("title", r.title ?? "");
      form.setFieldValue("description", r.description ?? "");
      form.setFieldValue("passing_score", r.passing_score ?? 80);
      form.setFieldValue("time_limit_minutes", r.time_limit_minutes ?? 15);
      form.setFieldValue("questions_per_attempt", r.questions_per_attempt ?? 10);
      form.setFieldValue("shuffle_questions", r.shuffle_questions ?? true);
      form.setFieldValue("shuffle_options", r.shuffle_options ?? true);
      form.setFieldValue("valid_months", r.valid_months ?? 12);
      form.setFieldValue("active", r.active ?? true);
    }
  }, [record]);

  const isLoading = useMemo(
    () => createMutation.isPending || updateMutation.isPending,
    [createMutation.isPending, updateMutation.isPending]
  );

  const numberField = (name: string, label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <form.Field name={name as any}>
        {(field: any) => (
          <Input
            type="number"
            value={field.state.value}
            onChange={(e) => field.handleChange(Number(e.target.value))}
          />
        )}
      </form.Field>
    </div>
  );

  const switchField = (name: string, label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div>
        <form.Field name={name as any}>
          {(field: any) => (
            <Switch checked={field.getValue()} onCheckedChange={field.setValue} />
          )}
        </form.Field>
      </div>
    </div>
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
        <Label>{t("tests.name")}</Label>
        <form.Field name="title">
          {(field) => (
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      </div>
      <div className="space-y-2">
        <Label>{t("tests.description")}</Label>
        <form.Field name="description">
          {(field) => (
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      </div>
      {numberField("passing_score", t("tests.passingScore"))}
      {numberField("time_limit_minutes", t("tests.timeLimit"))}
      {numberField("questions_per_attempt", t("tests.questionsPerAttempt"))}
      {numberField("valid_months", t("tests.validMonths"))}
      {switchField("shuffle_questions", t("tests.shuffleQuestions"))}
      {switchField("shuffle_options", t("tests.shuffleOptions"))}
      {switchField("active", t("tests.active"))}
      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("common.submit")}
      </Button>
    </form>
  );
}
