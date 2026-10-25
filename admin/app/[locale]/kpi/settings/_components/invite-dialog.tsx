"use client";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { kpiApi, type KpiInvite, type TgTarget } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { inviteHint } from "@admin/lib/kpi/telegram";
import { qk } from "../../_components/use-kpi";

/**
 * Ссылка-приглашение в бота. Создаётся только по кнопке: новая ссылка гасит прежнюю,
 * и случайное открытие окна не должно сломать уже разосланную. Токен виден только в ссылке и QR;
 * `gcTime: 0` не оставляет ответ в кэше мутаций после закрытия окна.
 */
export function InviteDialog({ target, name, open, onClose }: { target: TgTarget; name: string; open: boolean; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {/* Тело монтируется только при открытии: закрыли — ссылка из состояния компонента ушла. */}
        {open && <InviteBody target={target} name={name} onClose={onClose} onPending={setPending} />}
      </DialogContent>
    </Dialog>
  );
}

function InviteBody({
  target,
  name,
  onClose,
  onPending,
}: {
  target: TgTarget;
  name: string;
  onClose: () => void;
  onPending: (p: boolean) => void;
}) {
  const qc = useQueryClient();
  const [invite, setInvite] = useState<KpiInvite | null>(null);

  const create = useMutation({
    mutationFn: () => kpiApi.tg.invite(target),
    gcTime: 0,
    onMutate: () => onPending(true),
    onSuccess: (r) => setInvite(r),
    onError: (e) => toast.error(kpiErrorText(e)),
    onSettled: () => onPending(false),
  });
  const busy = create.isPending;

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать: выделите ссылку и скопируйте вручную");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ссылка-приглашение</DialogTitle>
        <DialogDescription>{name}</DialogDescription>
      </DialogHeader>

      {invite ? (
        <div className="space-y-3">
          <div className="flex justify-center rounded-md bg-white p-2">
            <QRCodeSVG value={invite.link} size={200} marginSize={4} level="M" />
          </div>
          <div className="flex gap-2">
            <Input readOnly aria-label="Ссылка-приглашение" className="h-11" value={invite.link} onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" className="h-11" onClick={copy}>
              Скопировать
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{inviteHint(invite.expires_at)}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ссылка создаётся по кнопке. Новая ссылка отменяет прежнюю, поэтому не создавайте её без нужды, если прежняя уже отправлена.
        </p>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        {invite && (
          <Button type="button" variant="outline" className="h-11" onClick={() => qc.invalidateQueries({ queryKey: qk.tgBindingsAll })}>
            Обновить статус
          </Button>
        )}
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
          Закрыть
        </Button>
        <Button type="button" className="h-11" disabled={busy} onClick={() => !busy && create.mutate()}>
          {invite ? "Создать новую ссылку" : "Создать ссылку"}
        </Button>
      </DialogFooter>
    </>
  );
}
