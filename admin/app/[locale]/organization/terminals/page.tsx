"use client";

import { DataTable } from "./data-table";
import { terminalsColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { RefreshCw } from "lucide-react";
import CanAccess from "@admin/components/can-access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { toast } from "sonner";

export default function TerminalsListPage() {
  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await apiClient.api.terminals.sync_iiko.post();
      if (error) {
        throw new Error(
          (error as any)?.value?.message ?? "Ошибка синхронизации с iiko"
        );
      }
      return data;
    },
    onSuccess: (data) => {
      const created = data?.created ?? 0;
      const errors = data?.errors ?? [];
      if (errors.length) {
        toast.warning(
          `Синхронизация завершена. Добавлено: ${created}. Проблемы: ${errors.join(
            "; "
          )}`
        );
      } else {
        toast.success(
          created > 0
            ? `Синхронизация завершена. Добавлено филиалов: ${created}`
            : "Синхронизация завершена. Новых филиалов нет."
        );
      }
      queryClient.invalidateQueries({ queryKey: ["terminals"] });
      queryClient.invalidateQueries({ queryKey: ["filter_terminals"] });
      queryClient.invalidateQueries({ queryKey: ["terminals_cached"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Ошибка синхронизации с iiko");
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Terminals List</h2>
        <CanAccess permission="terminals.add">
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                syncMutation.isPending ? "animate-spin" : ""
              }`}
            />
            {syncMutation.isPending ? "Синхронизация..." : "Синхронизация с iiko"}
          </Button>
        </CanAccess>
      </div>
      <div className="py-10">
        <DataTable columns={terminalsColumns} />
      </div>
    </div>
  );
}
