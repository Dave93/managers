"use client";

// Row actions: the QR, the journal, the close.
//
// The two destructive ones say what they actually do, in the confirmation,
// before the button is pressed:
//
//  * Reinvite BACKDATES every live unused invite of the enrollment and issues
//    one fresh code. That means a QR already printed and handed over stops
//    working the instant this succeeds. Someone may be holding that sheet of
//    paper right now, so the dialog leads with that, not with the reassurance.
//    There is deliberately no "reprint the current code" action: the backend
//    exposes no way to read an existing invite id (by design — an invite is a
//    bearer token), so the only honest label for this button is "выдать НОВЫЙ".
//
//  * Close revokes the same unused invites and marks the outcome. It does not
//    kill a session that was already redeemed — the miniapp session lives in
//    Redis for up to 12h — so the copy promises "новые входы по QR", not
//    instant lockout.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  QrCode,
  ScrollText,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/buttonOrigin";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu";
import { cn } from "@admin/lib/utils";
import {
  closeEnrollment,
  reinvite,
  type PassportEnrollmentRow,
} from "@admin/lib/passport-api";

import { isLive } from "./status";
import type { InviteToPrint } from "./invite-print";
import {
  apiMessage,
  fullName,
  qk,
  useTerminalNames,
} from "./use-enrollments";

type CloseResult = "completed" | "failed";

export function RowActions({
  row,
  canManage,
  onPrint,
  onJournal,
}: {
  row: PassportEnrollmentRow;
  canManage: boolean;
  onPrint: (invite: InviteToPrint) => void;
  onJournal: (row: PassportEnrollmentRow) => void;
}) {
  const queryClient = useQueryClient();
  const terminalName = useTerminalNames();
  const [askReinvite, setAskReinvite] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const [result, setResult] = useState<CloseResult>("completed");

  const live = isLive(row.status);
  const name = fullName(row.first_name, row.last_name);

  const issue = useMutation({
    mutationFn: async () => {
      const { data, error } = await reinvite(row.id);
      if (error) throw new Error(apiMessage(error));
      return data!;
    },
    onSuccess: (res) => {
      toast.success(
        res.revoked > 0
          ? `Новый код выпущен. Аннулировано старых кодов: ${res.revoked} — если они распечатаны, заберите листки.`
          : "Новый код выпущен. Действующих старых кодов не было."
      );
      setAskReinvite(false);
      onPrint({
        inviteId: res.invite_id,
        expiresAt: res.expires_at,
        traineeName: name,
        position: row.position,
        programRu: row.program_title_ru,
        programUz: row.program_title_uz,
        branch: terminalName(row.terminal_id),
      });
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  const close = useMutation({
    mutationFn: async (r: CloseResult) => {
      const { data, error } = await closeEnrollment(row.id, r);
      if (error) throw new Error(apiMessage(error));
      return data!;
    },
    onSuccess: (_d, r) => {
      toast.success(
        r === "completed"
          ? "Стажировка завершена: испытательный срок пройден."
          : "Стажировка закрыта: испытательный срок не пройден."
      );
      queryClient.invalidateQueries({ queryKey: qk.enrollmentsAll });
      setAskClose(false);
    },
    onError: (e: any) => toast.error(apiMessage(e)),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="size-8 p-0">
            <span className="sr-only">Действия</span>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onJournal(row)}>
            <ScrollText className="mr-2 size-3.5" /> Журнал
          </DropdownMenuItem>
          {canManage && live && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAskReinvite(true)}>
                <QrCode className="mr-2 size-3.5" /> Выдать новый QR
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  setResult("completed");
                  setAskClose(true);
                }}
              >
                <CheckCircle2 className="mr-2 size-3.5" /> Завершить стажировку
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ------------------------------ reinvite ----------------------------- */}
      <AlertDialog open={askReinvite} onOpenChange={setAskReinvite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выпустить новый QR-код?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[13px] leading-snug">
                <p>
                  Стажёр: <b>{name}</b>
                  {row.position ? ` · ${row.position}` : ""} ·{" "}
                  {row.program_title_ru ?? "программа не указана"}.
                </p>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  Все ранее выданные коды этой стажировки перестанут работать
                  сразу. Если распечатанный QR уже у человека на руках — этот
                  листок станет мёртвым, заберите его и отдайте новый.
                </p>
                <p>
                  Новый код одноразовый и действует 7 дней. Сразу после выпуска
                  откроется страница печати.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={issue.isPending}>
              Отмена
            </AlertDialogCancel>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              {issue.isPending && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              Выпустить и напечатать
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -------------------------------- close ------------------------------ */}
      <AlertDialog open={askClose} onOpenChange={setAskClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Завершить стажировку?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-[13px] leading-snug">
                <p>
                  Стажёр: <b>{name}</b>
                  {row.position ? ` · ${row.position}` : ""} ·{" "}
                  {row.program_title_ru ?? "программа не указана"}.
                </p>

                <div className="space-y-1.5">
                  <p className="font-medium text-foreground">Итог:</p>
                  {(
                    [
                      {
                        v: "completed" as const,
                        icon: CheckCircle2,
                        label: "Испытательный срок пройден",
                        hint: "Стажёр допущен к самостоятельной работе.",
                        tone: "text-emerald-600 dark:text-emerald-400",
                      },
                      {
                        v: "failed" as const,
                        icon: XCircle,
                        label: "Испытательный срок не пройден",
                        hint: "Паспорт закрывается как непройденный. Запись останется в истории сотрудника.",
                        tone: "text-red-600 dark:text-red-400",
                      },
                    ] as const
                  ).map((o) => {
                    const Icon = o.icon;
                    const on = result === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => setResult(o.v)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                          on
                            ? "border-foreground/40 bg-accent"
                            : "border-border hover:bg-accent/50"
                        )}
                      >
                        <Icon className={cn("mt-0.5 size-4 shrink-0", o.tone)} />
                        <span>
                          <span className="block text-[13px] font-medium text-foreground">
                            {o.label}
                          </span>
                          <span className="block text-[11.5px] text-muted-foreground">
                            {o.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="rounded-md border border-border/70 bg-muted/50 px-2.5 py-2">
                  Невыданные и нераспечатанные QR-коды этой стажировки перестанут
                  работать — новые входы по ним станут невозможны (уже открытая у
                  стажёра сессия в Telegram может доработать до 12 часов). Заново
                  открыть закрытую стажировку из админки нельзя — понадобится
                  начать новую. Журнал и все отметки наставников сохранятся.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={close.isPending}>
              Отмена
            </AlertDialogCancel>
            <Button
              variant={result === "failed" ? "destructive" : "default"}
              onClick={() => close.mutate(result)}
              disabled={close.isPending}
            >
              {close.isPending && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              {result === "failed"
                ? "Закрыть как непройденную"
                : "Завершить успешно"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
