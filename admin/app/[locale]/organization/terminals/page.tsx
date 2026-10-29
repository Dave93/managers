"use client";

import { DataTable } from "./data-table";
import { useTerminalsColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { RefreshCw } from "lucide-react";
import CanAccess from "@admin/components/can-access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function TerminalsListPage() {
  const columns = useTerminalsColumns();
  const t = useTranslations("organizationPages.terminals");
  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await apiClient.api.terminals.sync_iiko.post();
      if (error) {
        throw new Error(
          (error as any)?.value?.message ?? t("syncError")
        );
      }
      return data;
    },
    onSuccess: (data) => {
      const created = data?.created ?? 0;
      const errors = data?.errors ?? [];
      if (errors.length) {
        toast.warning(
          t("syncDoneWithIssues", {
            created: String(created),
            issues: errors.join("; "),
          })
        );
      } else {
        toast.success(
          created > 0
            ? t("syncDoneCreated", { created: String(created) })
            : t("syncDoneNone")
        );
      }
      queryClient.invalidateQueries({ queryKey: ["terminals"] });
      queryClient.invalidateQueries({ queryKey: ["filter_terminals"] });
      queryClient.invalidateQueries({ queryKey: ["terminals_cached"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? t("syncError"));
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
            {syncMutation.isPending ? t("syncing") : t("sync")}
          </Button>
        </CanAccess>
      </div>
      <div className="py-10">
        <DataTable columns={columns} />
      </div>
    </div>
  );
}
