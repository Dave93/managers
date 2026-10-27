"use client";
import React, { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Switch } from "@admin/components/ui/switch";
import { kpiApi, type KpiSettings } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { SETTINGS_FIELDS, settingsIssues, settingsPatch } from "@admin/lib/kpi/settings";
import { qk } from "../../_components/use-kpi";

export function DeadlinesTab() {
  const settings = useQuery<KpiSettings, Error>({
    queryKey: qk.settings,
    queryFn: () => kpiApi.settings.get(),
    retry: shouldRetry,
  });
  if (settings.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
        {kpiErrorText(settings.error)}
      </p>
    );
  }
  if (!settings.data) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  return <DeadlinesForm before={settings.data} />;
}

function DeadlinesForm({ before }: { before: KpiSettings }) {
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const form = useForm({
    defaultValues: before,
    onSubmit: ({ value }) => submit(value),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<KpiSettings>) => kpiApi.settings.save(patch),
    onSuccess: (saved) => {
      qc.setQueryData(qk.settings, saved);
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      toast.success("Настройки сохранены");
    },
    onError: (e) => setProblem(kpiErrorText(e)),
  });
  const busy = save.isPending;

  const submit = (values: KpiSettings) => {
    if (busy) return;
    const issues = settingsIssues(values);
    if (issues.length > 0) {
      setProblem(issues.join(". "));
      return;
    }
    const patch = settingsPatch(before, values);
    if (Object.keys(patch).length === 0) {
      setProblem(null);
      toast.message("Нет изменений");
      return;
    }
    setProblem(null);
    save.mutate(patch);
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="max-w-xl space-y-4"
    >
      {SETTINGS_FIELDS.map((f) => (
        <form.Field key={f.key} name={f.key}>
          {(field) => {
            const id = `kpi-setting-${f.key}`;
            if (f.kind === "bool") {
              return (
                <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch id={id} checked={field.state.value as boolean} disabled={busy} onCheckedChange={(v) => { setProblem(null); field.handleChange(v as never); }} />
                  {f.label}
                </label>
              );
            }
            const v = field.state.value as number;
            return (
              <div className="space-y-1">
                <Label htmlFor={id}>{f.label}</Label>
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  className="h-11 w-40"
                  value={Number.isNaN(v) ? "" : String(v)}
                  disabled={busy}
                  onChange={(e) => {
                    setProblem(null);
                    field.handleChange((e.target.value === "" ? NaN : Number(e.target.value)) as never);
                  }}
                />
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            );
          }}
        </form.Field>
      ))}

      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}

      <Button type="submit" className="h-11" disabled={busy}>
        Сохранить
      </Button>
    </form>
  );
}
