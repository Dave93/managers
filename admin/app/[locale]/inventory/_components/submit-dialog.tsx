"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { inventoryApi } from "@admin/lib/inventory-api";
import type { OverlayDetail } from "@admin/lib/inventory/queue";

export function SubmitDialog({
  detail,
  pendingCount,
  onDone,
}: {
  detail: OverlayDetail;
  pendingCount: number;
  onDone: () => void;
}) {
  const t = useTranslations("inventory.submit");
  const tRoot = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const skipped = detail.lines.filter((l) => l.skipped).length;
  const counted = detail.lines.filter((l) => !l.skipped && l.entries.length > 0).length;
  const incomplete = detail.lines.length - skipped - counted;

  const submit = useMutation({
    mutationFn: (skipIncomplete: boolean) => inventoryApi.submit(detail.id, skipIncomplete),
    onSuccess: () => {
      setOpen(false);
      toast.success(t("done"));
      onDone();
    },
    onError: (e: Error) => toast.error(tRoot("errors.generic", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">{t("button")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <div>{t("counted", { count: counted })}</div>
          <div>{t("skipped", { count: skipped })}</div>
          <div className={incomplete > 0 ? "text-destructive font-medium" : ""}>{t("incomplete", { count: incomplete })}</div>
          {pendingCount > 0 && <div className="text-orange-600">{t("pendingBlock")}</div>}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="lg" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          {incomplete > 0 ? (
            <Button size="lg" disabled={pendingCount > 0 || submit.isPending} onClick={() => submit.mutate(true)}>
              {t("skipAll")}
            </Button>
          ) : (
            <Button size="lg" disabled={pendingCount > 0 || submit.isPending} onClick={() => submit.mutate(false)}>
              {t("confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
