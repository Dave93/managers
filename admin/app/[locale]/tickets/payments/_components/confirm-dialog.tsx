"use client";

import { useTranslations } from "next-intl";

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
  const t = useTranslations("ticketsUi.payments.confirm");
  const c = confirmation;
  const n = c?.ids.length ?? 0;
  const approve = c?.kind === "approve";
  const reasonMissing = !approve && comment.trim() === "";
  return (
    <AlertDialog open={c !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(approve ? "titleApprove" : "titleReject", { count: n })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {c && c.totalMinor !== null && (
              <>
                {t("total", { amount: formatMinor(c.totalMinor) })}{" "}
              </>
            )}
            {approve
              ? t("noteApprove")
              : t("noteReject")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!approve && (
          <Textarea
            value={comment}
            onChange={(e) => onComment(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            aria-label={t("reasonAria")}
            rows={3}
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("notNow")}</AlertDialogCancel>
          <AlertDialogAction disabled={reasonMissing} onClick={() => c && onConfirm(c)}>
            {t(approve ? "confirmApprove" : "confirmReject", { count: n })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
