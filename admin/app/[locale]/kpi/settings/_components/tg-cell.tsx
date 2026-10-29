"use client";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const unbind = useMutation({
    mutationFn: (id: string) => kpiApi.tg.unbind(id),
    onSuccess: () => toast.success("Telegram отвязан"),
    onError: (e) => toast.error(kpiErrorText(e)),
    // Сброс и при ошибке: после not_found устаревший статус должен обновиться.
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tgBindingsAll }),
  });

  // Статус неизвестен: не показываем «Не привязан» и не даём действий, которые от него зависят.
  if (state === "loading") return <span className="text-sm text-muted-foreground" aria-label="Статус Telegram загружается">…</span>;
  if (state === "error") return <span className="text-sm text-muted-foreground" aria-label="Статус Telegram недоступен">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <KpiBadge tone={binding ? "green" : "gray"}>{bindingLabel(binding)}</KpiBadge>
      <Button type="button" variant="outline" className="h-11" onClick={() => setInviteOpen(true)}>
        Ссылка-приглашение
      </Button>
      {binding && (
        <Button type="button" variant="outline" className="h-11" disabled={unbind.isPending} onClick={() => setConfirmOpen(true)}>
          Отвязать
        </Button>
      )}

      <InviteDialog target={target} name={name} binding={binding} open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать Telegram?</AlertDialogTitle>
            <AlertDialogDescription>{`Отвязать Telegram у ${name}? Уведомления перестанут приходить.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
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
              Отвязать
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
