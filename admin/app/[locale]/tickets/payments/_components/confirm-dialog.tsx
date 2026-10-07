"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { Textarea } from "@components/ui/textarea";

import type { Decision } from "./action-panel";
import { formatMinor } from "@admin/lib/tickets-money";

// Снимок того, что пользователь подтверждает. Список заявок обновляется раз в
// минуту и после чужих решений, поэтому диалог показывает и отправляет ровно
// тот набор, на который нажали, а не то, что выбрано в момент нажатия «Да».
export type Confirmation = {
  kind: Decision;
  ids: string[];
  totalMinor: bigint | null;
};

const noun = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "заявке" : "заявкам");

export function ConfirmDialog({
  confirmation,
  comment,
  onComment,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation | null;
  comment: string;
  onComment: (v: string) => void;
  onCancel: () => void;
  onConfirm: (c: Confirmation) => void;
}) {
  const c = confirmation;
  const n = c?.ids.length ?? 0;
  const approve = c?.kind === "approve";
  const reasonMissing = !approve && comment.trim() === "";
  return (
    <AlertDialog open={c !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {approve ? "Утвердить" : "Отклонить"} оплату по {n} {noun(n)}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {c && c.totalMinor !== null && (
              <>
                Сумма по выбранным: {formatMinor(c.totalMinor)} сум.{" "}
              </>
            )}
            {approve
              ? "Вернуть утверждение в очередь из админки нельзя."
              : "Заявки останутся закрытыми, оплата по ним будет отклонена. Причина сохранится в заявке."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!approve && (
          <Textarea
            value={comment}
            onChange={(e) => onComment(e.target.value)}
            placeholder="Причина отклонения (обязательно)"
            aria-label="Причина отклонения"
            rows={3}
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Не сейчас</AlertDialogCancel>
          <AlertDialogAction disabled={reasonMissing} onClick={() => c && onConfirm(c)}>
            {approve ? `Утвердить ${n}` : `Отклонить ${n}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
