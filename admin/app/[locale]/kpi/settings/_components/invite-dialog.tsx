"use client";
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { kpiApi, type KpiInvite, type TgBindingRow, type TgTarget } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { bindingLabel, inviteHint } from "@admin/lib/kpi/telegram";
import { qk } from "../../_components/use-kpi";

/**
 * Ссылка-приглашение в бота. Создаётся только по кнопке: новая ссылка гасит прежнюю,
 * и случайное открытие окна не должно сломать уже разосланную. Токен виден только в ссылке и QR;
 * `gcTime: 0` не оставляет ответ в кэше мутаций после закрытия окна.
 * `binding` — текущая привязка из таблицы: когда появляется новая, окно показывает «Telegram подключён» вместо QR и ссылки.
 */
export function InviteDialog({
  target,
  name,
  binding,
  open,
  onClose,
}: {
  target: TgTarget;
  name: string;
  binding: TgBindingRow | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {/* Тело монтируется только при открытии: закрыли — ссылка из состояния компонента ушла. */}
        {open && <InviteBody target={target} name={name} binding={binding} onClose={onClose} onPending={setPending} />}
      </DialogContent>
    </Dialog>
  );
}

/** Привязка по ссылке обновляет created_at той же строки: новой считаем и новую строку, и новую дату. */
const bindingKey = (b: TgBindingRow | undefined) => (b ? `${b.id}:${b.created_at}` : null);

function InviteBody({
  target,
  name,
  binding,
  onClose,
  onPending,
}: {
  target: TgTarget;
  name: string;
  binding: TgBindingRow | undefined;
  onClose: () => void;
  onPending: (p: boolean) => void;
}) {
  const qc = useQueryClient();
  const [invite, setInvite] = useState<KpiInvite | null>(null);
  // Привязка, которая уже была при открытии окна или при создании ссылки. Окно уже привязанного сотрудника
  // открывается как обычно: «Привязан» показываем, только когда привязка появилась после этого.
  const [seenKey, setSeenKey] = useState(() => bindingKey(binding));
  const bound = binding && bindingKey(binding) !== seenKey ? binding : null;

  const create = useMutation({
    mutationFn: () => kpiApi.tg.invite(target),
    gcTime: 0,
    // Ключ берём до запроса: привязка, появившаяся, пока ссылка создаётся, не должна считаться уже виденной.
    onMutate: () => {
      onPending(true);
      setSeenKey(bindingKey(binding));
    },
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

      {bound ? (
        <div role="status" className="space-y-1 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          <div className="font-medium">Telegram подключён</div>
          <div>
            {bindingLabel(bound)}, с {formatTashkent(bound.created_at)}
          </div>
          {"employee_id" in target && <div>Сотрудник откроет «Мой KPI» кнопкой меню бота</div>}
        </div>
      ) : invite ? (
        <div className="space-y-3">
          <div className="flex justify-center rounded-md bg-white p-2">
            <QRCodeSVG value={invite.link} size={200} marginSize={4} level="M" />
          </div>
          <div className="flex gap-2">
            <Input readOnly aria-label="Ссылка-приглашение" className="h-11 min-w-0 flex-1" value={invite.link} onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" className="h-11 shrink-0" onClick={copy}>
              Скопировать
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{inviteHint(invite.expires_at)}</p>
          {"employee_id" in target && (
            <p className="text-xs text-muted-foreground">После привязки сотрудник откроет «Мой KPI» кнопкой меню бота</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ссылка создаётся по кнопке. Новая ссылка отменяет прежнюю, поэтому не создавайте её без нужды, если прежняя уже отправлена.
        </p>
      )}

      {/* Три кнопки не помещаются в sm:max-w-md в одну строку: переносим. */}
      <DialogFooter className="gap-2 sm:flex-wrap sm:gap-2">
        {invite && !bound && (
          <Button type="button" variant="outline" className="h-11" onClick={() => qc.invalidateQueries({ queryKey: qk.tgBindingsAll })}>
            Обновить статус
          </Button>
        )}
        {/* После привязки главное действие — «Закрыть»; новая ссылка остаётся, но второстепенной кнопкой. */}
        <Button type="button" variant={bound ? "default" : "outline"} className="h-11" disabled={busy} onClick={onClose}>
          Закрыть
        </Button>
        <Button
          type="button"
          variant={bound ? "outline" : "default"}
          className="h-11"
          disabled={busy}
          onClick={() => !busy && create.mutate()}
        >
          {invite || bound ? "Создать новую ссылку" : "Создать ссылку"}
        </Button>
      </DialogFooter>
    </>
  );
}
