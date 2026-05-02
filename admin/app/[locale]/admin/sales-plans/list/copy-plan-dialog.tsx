"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@admin/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import { toast } from "sonner";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourcePlanIds: string[];
  sourceLabel: string;
  sourceYear: number;
  sourceMonth: number;
  onSuccess: () => void;
};

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

export function CopyPlanDialog({
  open,
  onOpenChange,
  sourcePlanIds,
  sourceLabel,
  sourceYear,
  sourceMonth,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();

  const [targetYear, setTargetYear] = useState(String(sourceYear));
  const [targetMonth, setTargetMonth] = useState(String(sourceMonth));

  useEffect(() => {
    if (open) {
      const { year, month } = nextMonth(sourceYear, sourceMonth);
      setTargetYear(String(year));
      setTargetMonth(String(month));
    }
  }, [open, sourceYear, sourceMonth]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, status } = await apiClient.api.sales_plans.copy.post({
        source_plan_ids: sourcePlanIds,
        target_year: Number(targetYear),
        target_month: Number(targetMonth),
      });
      if (status !== 200) {
        throw new Error((data as any)?.message ?? "Ошибка копирования");
      }
      return data as { created: any[]; skipped: any[] };
    },
    onSuccess: (res) => {
      const createdN = res.created.length;
      const skippedN = res.skipped.length;

      if (createdN === 0 && skippedN > 0) {
        toast.error("Все планы уже существуют в выбранном месяце");
      } else if (skippedN === 0) {
        toast.success(`Скопировано: ${createdN}`);
      } else {
        toast(`Создано: ${createdN}. Пропущено: ${skippedN} (уже существуют)`);
      }

      queryClient.invalidateQueries({ queryKey: ["sales_plans"] });
      onOpenChange(false);
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isMulti = sourcePlanIds.length > 1;
  const title = isMulti ? `Копировать планы (${sourcePlanIds.length})` : "Копировать план";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {sourceLabel} будет скопирован в выбранный месяц
        </p>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Год</label>
            <Select value={targetYear} onValueChange={setTargetYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2027">2027</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Месяц</label>
            <Select value={targetMonth} onValueChange={setTargetMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Копирование..." : "Копировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
