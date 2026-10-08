"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Link } from "@admin/i18n/routing";
import { inventoryApi } from "@admin/lib/inventory-api";
import { useCountSync } from "@admin/lib/inventory/use-count-sync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { useMyPermissions } from "@admin/lib/inventory/use-permissions";
import { AddProductDialog } from "../_components/add-product-dialog";
import { BookCompare } from "../_components/book-compare";
import { CountHeader } from "../_components/count-header";
import { CountTable } from "../_components/count-table";
import { SubmitDialog } from "../_components/submit-dialog";

// Очередь и кэш живут в localStorage, которого нет при SSR: рендерим экран
// только после монтирования, иначе первая отрисовка на клиенте расходится с
// серверной (hydration mismatch).
export default function CountPage() {
  const { id } = useParams<{ id: string }>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="p-4">…</div>;
  return <CountScreen id={id} />;
}

function CountScreen({ id }: { id: string }) {
  const t = useTranslations("inventory");
  const sync = useCountSync(id, t("line.you"));
  const { detail } = sync;
  const perms = useMyPermissions() ?? [];
  // «Сравнение с учётом»: сервер отдаёт его офису и филиалу после фиксации пересчёта, иначе 403.
  const book = useQuery({
    queryKey: ["inventory_book", id],
    queryFn: () => inventoryApi.book(id),
    enabled: detail?.status === "submitted",
    retry: false,
    refetchInterval: (q) => (q.state.data && !q.state.data.fetched_at ? 5000 : false),
  });

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
    <div className="p-3 sm:p-4 pb-24 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/inventory" className="text-sm underline">
          ← {t("back")}
        </Link>
        {editable && detail.can_manage && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              if (window.confirm(t("cancelConfirm"))) cancel.mutate();
            }}
          >
            {t("cancelCount")}
          </Button>
        )}
      </div>
      <CountHeader
        detail={detail}
        online={sync.online}
        pendingCount={sync.pendingCount}
        rejectedCount={sync.rejectedCount}
        authExpired={sync.authExpired}
        onDismissRejected={sync.dismissRejected}
        onResendRejected={sync.resendRejected}
      />
      {/* Кнопки над списком: внизу фиксированная панель закрывала последние строки. */}
      {(editable || detail.can_reopen) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editable ? <AddProductDialog countId={id} online={sync.online} onAdded={() => void sync.refetch()} /> : <span />}
          <div className="flex flex-wrap items-center gap-2">
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
      )}
      {book.data ? (
        <Tabs defaultValue="input">
          <TabsList>
            <TabsTrigger value="input">{t("book.inputTab")}</TabsTrigger>
            <TabsTrigger value="book">{t("book.tab")}</TabsTrigger>
          </TabsList>
          <TabsContent value="input" className="pt-4">
            <CountTable
              detail={detail}
              online={sync.online}
              onAdd={sync.addEntries}
              onDelete={sync.deleteEntry}
              onSkip={(lineId, skipped) => skip.mutate({ lineId, skipped })}
            />
          </TabsContent>
          <TabsContent value="book" className="pt-4">
            <BookCompare
              countId={id}
              countDate={detail.count_date}
              data={book.data}
              canRefresh={perms.includes("inventory.reconcile")}
              onRefreshed={() => void book.refetch()}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <CountTable
          detail={detail}
          online={sync.online}
          onAdd={sync.addEntries}
          onDelete={sync.deleteEntry}
          onSkip={(lineId, skipped) => skip.mutate({ lineId, skipped })}
        />
      )}
      {/* Та же кнопка под списком: товар, которого нет в списке, обычно находят, дойдя до конца. */}
      {editable && <AddProductDialog countId={id} online={sync.online} onAdded={() => void sync.refetch()} />}
    </div>
  );
}
