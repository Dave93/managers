"use client";
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type Tier } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { formatSum } from "@admin/lib/kpi/format";
import { tiersFromDraft, type TierDraft } from "@admin/lib/kpi/settings";
import { qk, useKpiMe } from "../../_components/use-kpi";

const toDraft = (tiers: readonly Tier[]): TierDraft[] =>
  tiers.map((t) => ({ min_pct: String(t.min_pct).replace(".", ","), amount: String(t.amount) }));

export function TiersTab() {
  const qc = useQueryClient();
  const me = useKpiMe();
  const tiers = useQuery<Tier[], Error>({
    queryKey: qk.tiers,
    queryFn: () => kpiApi.tiers.get(),
    retry: shouldRetry,
  });
  const [rows, setRows] = useState<TierDraft[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Черновик заполняется один раз из сервера; дальше его ведёт пользователь.
  useEffect(() => {
    if (tiers.data && rows === null) setRows(toDraft(tiers.data));
  }, [tiers.data, rows]);

  const cap = me.data?.settings.raise_cap;

  const save = useMutation({
    mutationFn: (t: Tier[]) => kpiApi.tiers.save(t),
    onSuccess: (saved) => {
      qc.setQueryData(qk.tiers, saved);
      setRows(toDraft(saved));
      toast.success("Шкала сохранена");
    },
    onError: (e) => setProblem(kpiErrorText(e)),
  });
  const busy = save.isPending;

  const update = (i: number, patch: Partial<TierDraft>) => {
    setProblem(null);
    setRows((cur) => (cur ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const submit = () => {
    if (busy || rows === null || cap === undefined) return;
    const res = tiersFromDraft(rows, cap);
    if ("error" in res) {
      setProblem(res.error);
      return;
    }
    setProblem(null);
    save.mutate(res.tiers);
  };

  if (tiers.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
        {kpiErrorText(tiers.error)}
      </p>
    );
  }
  if (tiers.isPending || rows === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Средняя от, %</TableHead>
              <TableHead>Повышение, сум</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-sm text-muted-foreground">
                  Ступеней нет: повышение никому не положено
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    aria-label={`Порог ступени ${i + 1}, %`}
                    inputMode="decimal"
                    className="h-11 w-32"
                    value={r.min_pct}
                    disabled={busy}
                    onChange={(e) => update(i, { min_pct: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Сумма ступени ${i + 1}, сум`}
                    inputMode="numeric"
                    className="h-11 w-40"
                    value={r.amount}
                    disabled={busy}
                    onChange={(e) => update(i, { amount: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={busy}
                    onClick={() => {
                      setProblem(null);
                      setRows((cur) => (cur ?? []).filter((_, j) => j !== i));
                    }}
                  >
                    Убрать
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={() => {
            setProblem(null);
            setRows((cur) => [...(cur ?? []), { min_pct: "", amount: "" }]);
          }}
        >
          Добавить ступень
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Ниже самой низкой ступени — без повышения.
        {cap !== undefined ? ` Потолок: ${formatSum(cap)}` : ""}
      </p>

      {me.error && (
        <p role="alert" className="text-sm text-destructive">
          {kpiErrorText(me.error)}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}

      <Button type="button" className="h-11" disabled={busy || cap === undefined} onClick={submit}>
        Сохранить шкалу
      </Button>
    </div>
  );
}
