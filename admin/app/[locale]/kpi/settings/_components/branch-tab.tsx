"use client";
// Вкладка «Балл филиала»: показатели (вес, порог, цель, максимум), нормативы сервиса, пункты санитарной проверки.
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type BranchConfig } from "@admin/lib/kpi-api";
import {
  branchSettingsIssues,
  indicatorBody,
  indicatorDraft,
  indicatorIssues,
  sanitaryItemsFromText,
  weightSum,
  type IndicatorDraft,
} from "@admin/lib/kpi/branch";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { qk } from "../../_components/use-kpi";

export function BranchTab() {
  const config = useQuery<BranchConfig, Error>({
    queryKey: qk.branchConfig,
    queryFn: () => kpiApi.branch.config(),
    retry: shouldRetry,
    // Форма с черновиком: фоновое обновление её не трогает (черновик всё равно живёт в состоянии).
    refetchOnWindowFocus: false,
  });
  if (config.error && !config.data) {
    return (
      <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
        {kpiErrorText(config.error)}
      </p>
    );
  }
  if (!config.data) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  return <BranchForm cfg={config.data} />;
}

type FieldKey = "weight" | "floor" | "target" | "max";
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "weight", label: "Вес, %" },
  { key: "floor", label: "Порог" },
  { key: "target", label: "Цель" },
  { key: "max", label: "Максимум" },
];

function BranchForm({ cfg }: { cfg: BranchConfig }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<IndicatorDraft[]>(() => indicatorDraft(cfg.indicators));
  const [hall, setHall] = useState(String(cfg.settings.service_norm_hall_min));
  const [delivery, setDelivery] = useState(String(cfg.settings.service_norm_delivery_min));
  const [itemsText, setItemsText] = useState(cfg.settings.sanitary_items.join("\n"));
  const [issues, setIssues] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: (b: Parameters<typeof kpiApi.branch.saveConfig>[0]) => kpiApi.branch.saveConfig(b),
    onSuccess: async (saved) => {
      qc.setQueryData(qk.branchConfig, saved);
      setRows(indicatorDraft(saved.indicators));
      setHall(String(saved.settings.service_norm_hall_min));
      setDelivery(String(saved.settings.service_norm_delivery_min));
      setItemsText(saved.settings.sanitary_items.join("\n"));
      toast.success("Настройки балла сохранены");
      // Форма санитарной проверки читает шаблон из этих же настроек.
      await qc.invalidateQueries({ queryKey: qk.sanitaryTemplate });
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });
  const busy = save.isPending;

  const patchRow = (code: string, patch: Partial<IndicatorDraft>) => {
    setIssues([]);
    setRows((cur) => cur.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  };

  const sum = weightSum(rows);

  const submit = () => {
    if (busy) return;
    const items = sanitaryItemsFromText(itemsText);
    const found = [...indicatorIssues(rows), ...branchSettingsIssues({ hall, delivery, items })];
    setIssues(found);
    if (found.length > 0) return;
    save.mutate({
      indicators: indicatorBody(rows),
      settings: {
        service_norm_hall_min: Number(hall.trim()),
        service_norm_delivery_min: Number(delivery.trim()),
        sanitary_items: items,
      },
    });
  };

  return (
    <form
      noValidate
      className="max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Показатель</TableHead>
              <TableHead>Активен</TableHead>
              {FIELDS.map((f) => (
                <TableHead key={f.key}>{f.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="min-w-40">
                  <div className="font-medium">{r.title_ru}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.direction === "higher_better" ? "больше — лучше" : "меньше — лучше"}
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    aria-label={`Активен: ${r.title_ru}`}
                    checked={r.active}
                    disabled={busy}
                    onCheckedChange={(v) => patchRow(r.code, { active: v })}
                  />
                </TableCell>
                {FIELDS.map((f) => (
                  <TableCell key={f.key}>
                    <Input
                      inputMode="decimal"
                      aria-label={`${f.label}: ${r.title_ru}`}
                      className="h-11 w-24 sm:h-9"
                      value={r[f.key]}
                      disabled={busy}
                      onChange={(e) => patchRow(r.code, { [f.key]: e.target.value })}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className={sum === 100 ? "text-sm" : "text-sm font-medium text-destructive"}>Сумма весов: {sum}&nbsp;%</p>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-1">
          <Label htmlFor="bt-hall">Норматив зала, мин</Label>
          <Input
            id="bt-hall"
            inputMode="numeric"
            className="h-11 w-40"
            value={hall}
            disabled={busy}
            onChange={(e) => {
              setIssues([]);
              setHall(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bt-delivery">Норматив доставки, мин</Label>
          <Input
            id="bt-delivery"
            inputMode="numeric"
            className="h-11 w-40"
            value={delivery}
            disabled={busy}
            onChange={(e) => {
              setIssues([]);
              setDelivery(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="bt-items">Пункты санитарной проверки, по одному в строке</Label>
        <Textarea
          id="bt-items"
          rows={6}
          value={itemsText}
          disabled={busy}
          onChange={(e) => {
            setIssues([]);
            setItemsText(e.target.value);
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Изменения действуют со следующего пересчёта. Посчитанные месяцы хранят веса и пороги на момент расчёта
      </p>

      {issues.length > 0 && (
        <ul role="alert" className="list-inside list-disc rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {issues.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <Button type="submit" className="h-11" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить"}
      </Button>
    </form>
  );
}
