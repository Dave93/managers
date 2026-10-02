"use client";
import { useParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Link } from "@admin/i18n/routing";
import { inventoryApi } from "@admin/lib/inventory-api";
import { useCountSync } from "@admin/lib/inventory/use-count-sync";
import { AddProductDialog } from "../_components/add-product-dialog";
import { CountHeader } from "../_components/count-header";
import { CountTable } from "../_components/count-table";
import { SubmitDialog } from "../_components/submit-dialog";

export default function CountPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("inventory");
  const sync = useCountSync(id, t("line.you"));
  const { detail } = sync;

  const skip = useMutation({
    mutationFn: ({ lineId, skipped }: { lineId: string; skipped: boolean }) => inventoryApi.setSkipped(id, lineId, skipped),
    onSuccess: () => void sync.refetch(),
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });
  const reopen = useMutation({
    mutationFn: () => inventoryApi.reopen(id),
    onSuccess: () => {
      toast.success(t("reopened"));
      void sync.refetch();
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });
  const cancel = useMutation({
    mutationFn: () => inventoryApi.cancel(id),
    onSuccess: () => {
      toast.success(t("cancelled"));
      void sync.refetch();
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });

  if (!detail) {
    return (
      <div className="p-4">
        {sync.error ? t("errors.generic", { message: (sync.error as Error).message }) : "…"}
      </div>
    );
  }

  const editable = detail.status === "draft" && detail.access === "write";

  return (
    <div className="p-3 sm:p-4 pb-40 space-y-4">
      <Link href="/inventory" className="text-sm underline">
        ← {t("back")}
      </Link>
      <CountHeader
        detail={detail}
        online={sync.online}
        pendingCount={sync.pendingCount}
        rejectedCount={sync.rejectedCount}
        onDismissRejected={sync.dismissRejected}
      />
      <CountTable
        detail={detail}
        online={sync.online}
        onAdd={sync.addEntries}
        onDelete={sync.deleteEntry}
        onSkip={(lineId, skipped) => skip.mutate({ lineId, skipped })}
      />
      <div className="fixed bottom-16 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-3 py-2 md:bottom-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          {editable && <AddProductDialog countId={id} online={sync.online} onAdded={() => void sync.refetch()} />}
          <div className="flex flex-wrap items-center gap-2">
            {editable && detail.can_manage && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  if (window.confirm(t("cancelConfirm"))) cancel.mutate();
                }}
              >
                {t("cancelCount")}
              </Button>
            )}
            {editable && detail.can_manage && (
              <SubmitDialog detail={detail} pendingCount={sync.pendingCount} onDone={() => void sync.refetch()} />
            )}
            {detail.can_reopen && (
              <Button variant="outline" size="lg" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                {t("reopen")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
