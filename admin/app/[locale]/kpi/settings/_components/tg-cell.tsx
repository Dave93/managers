"use client";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@admin/components/ui/alert-dialog";
import { Button } from "@admin/components/ui/button";
import { kpiApi, type TgBindingRow, type TgTarget } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { bindingLabel } from "@admin/lib/kpi/telegram";
import { KpiBadge } from "../../_components/kpi-badge";
import { qk } from "../../_components/use-kpi";
import { InviteDialog } from "./invite-dialog";
import type { TgState } from "./use-tg-bindings";

/** Ячейка «Telegram»: статус привязки, ссылка-приглашение и отвязка. */
export function TgCell({
  target,
  binding,
  state,
  name,
}: {
  target: TgTarget;
  binding: TgBindingRow | undefined;
  state: TgState;
  name: string;
}) {
  const t = useTranslations("kpi");
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const unbind = useMutation({
    mutationFn: (id: string) => kpiApi.tg.unbind(id),
    onSuccess: () => toast.success(t("settings.tgCell.unbound")),
    onError: (e) => toast.error(kpiErrorText(e, t)),
    // Сброс и при ошибке: после not_found устаревший статус должен обновиться.
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tgBindingsAll }),
  });

  // Статус неизвестен: не показываем «Не привязан» и не даём действий, которые от него зависят.
  if (state === "loading") return <span className="text-sm text-muted-foreground" aria-label={t("settings.tgCell.statusLoadingAria")}>…</span>;
  if (state === "error") return <span className="text-sm text-muted-foreground" aria-label={t("settings.tgCell.statusUnavailableAria")}>—</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <KpiBadge tone={binding ? "green" : "gray"}>{bindingLabel(binding, t)}</KpiBadge>
      <Button type="button" variant="outline" className="h-11" onClick={() => setInviteOpen(true)}>
        {t("settings.tgCell.invite")}
      </Button>
      {binding && (
        <Button type="button" variant="outline" className="h-11" disabled={unbind.isPending} onClick={() => setConfirmOpen(true)}>
          {t("settings.tgCell.unbind")}
        </Button>
      )}

      <InviteDialog target={target} name={name} binding={binding} open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.tgCell.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.tgCell.confirmText", { name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.tgCell.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={unbind.isPending || !binding}
              onClick={() => {
                if (!binding || unbind.isPending) return;
                unbind.mutate(binding.id);
                setConfirmOpen(false);
              }}
            >
              {t("settings.tgCell.unbind")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
