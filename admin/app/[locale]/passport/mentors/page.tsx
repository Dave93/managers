"use client";

// Наставники — the smallest page of the section and a hard gate in front of
// everything else: a branch manager cannot open the passport miniapp AT ALL
// until HR binds their Telegram account here. A trainee gets in by scanning a
// QR; a mentor has no QR and no invite, so without a row in this table there
// is simply no way in.
//
// Two things the copy on this page must be honest about, and both are load
// bearing:
//
//  1. UNBINDING IS NOT INSTANT REVOCATION. An already-issued miniapp session
//     lives in Redis for up to 12 hours and is not re-checked against this
//     table (a known gap inherited from the backend, documented on
//     deleteMentor() in lib/passport-api.ts). Promising immediate cut-off
//     would be the kind of lie that gets discovered during an incident, so the
//     confirmation says exactly what happens and what does not.
//
//  2. WHERE A MANAGER FINDS THEIR TELEGRAM ID. It is a number, it is not the
//     @username, and it is not discoverable from the Telegram UI. The answer
//     is on the page (TelegramIdHelp), not in somebody's head.
//
// A mentor row is `user_id` set and `employee_id` null — that null IS the role.
// This surface never touches a trainee binding in either direction; the
// backend refuses it and the refusal is rendered in full.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Link2Off,
  Loader2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { Button } from "@components/ui/buttonOrigin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { cn } from "@admin/lib/utils";
import { deleteMentor, refusalCode, type PassportMentorRow } from "@admin/lib/passport-api";

import { MentorSheet } from "./_components/mentor-sheet";
import { TelegramIdHelp } from "./_components/telegram-id-help";
import {
  apiMessage,
  fmtDate,
  qk,
  useMentors,
  useMentorsAccess,
  userLabel,
  userStatusLabel,
} from "./_components/use-mentors";

const PAGE = 100;

function Chip({
  tone,
  children,
  title,
}: {
  tone: "ok" | "warn" | "bad" | "muted";
  children: React.ReactNode;
  title?: string;
}) {
  const cls = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
    warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
    bad: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
    muted:
      "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300",
  }[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap",
        cls
      )}
    >
      {children}
    </span>
  );
}

function UnbindButton({ row }: { row: PassportMentorRow }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const unbind = useMutation({
    mutationFn: async () => {
      const { data, error } = await deleteMentor(row.telegram_id);
      if (error) {
        const e = new Error(apiMessage(error)) as any;
        e.value = (error as any)?.value;
        throw e;
      }
      return data!;
    },
    onSuccess: () => {
      toast.success("Привязка снята. Новый вход невозможен, уже открытая сессия догорит в течение 12 часов.");
      queryClient.invalidateQueries({ queryKey: qk.mentorsAll });
      setOpen(false);
    },
    onError: (e: any) => {
      const code = refusalCode(e);
      if (code === "binding_is_trainee")
        toast.error(
          "Это привязка стажёра, а не наставника — снять её отсюда нельзя."
        );
      else if (code === "binding_not_found")
        toast.error("Привязки уже нет — обновите список.");
      else toast.error(apiMessage(e));
    },
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Link2Off className="mr-1 size-3.5" /> Снять
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять привязку наставника?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-[12.5px] leading-snug">
                <p>
                  <b>{userLabel(row.user ?? {})}</b> больше не сможет войти в
                  мини-апп паспорта с Telegram{" "}
                  <span className="font-mono">{row.telegram_id}</span>: новых
                  сессий этому аккаунту выдаваться не будет.
                </p>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  <b>Это не мгновенный отзыв доступа.</b> Уже выданная сессия
                  мини-аппа живёт до 12 часов и против этой таблицы не
                  перепроверяется — если наставник сейчас внутри, он доработает
                  до конца этого окна и подпись, поставленная за это время,
                  будет действительной. Если доступ надо закрыть немедленно,
                  этого мало: нужна помощь администратора на стороне сервера.
                </p>
                <p className="text-muted-foreground">
                  История подписей не меняется: журнал append-only, всё, что
                  наставник подтвердил, остаётся в нём. Привязку можно завести
                  заново в любой момент — это та же форма.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unbind.isPending}>
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={unbind.isPending}
              onClick={(e) => {
                e.preventDefault();
                unbind.mutate();
              }}
            >
              {unbind.isPending && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              Снять привязку
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function MentorsPage() {
  const t = useTranslations("passport.mentors");
  const access = useMentorsAccess();
  const [page, setPage] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  const query = useMemo(
    () => ({ limit: String(PAGE), offset: String(page * PAGE) }),
    [page]
  );
  const q = useMentors(query, access.ready && access.canManage);

  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / PAGE), 1);

  if (access.ready && !access.canManage) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          Привязки наставников отдаются по праву{" "}
          <code className="font-mono text-[11px]">passport.mentors.manage</code>
          , а у вашей роли его нет. Обратитесь к администратору.
        </span>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-[12px] text-muted-foreground">{t("subtitle")}</p>
        </div>
        {/* Both mentor write routes are gated on passport.mentors.manage, so
            the affordance only appears once the permission is known to be
            held. It ALSO needs `users.list`: the form picks the office account
            from the users registry, and that list is a separate permission no
            seed bundles with mentors.manage. Without it the flow dead-ends
            inside the sheet on a 403, so the button is disabled up front and
            the banner below says why — nothing offered here can 403. */}
        {access.canManage && (
          <Button
            size="sm"
            disabled={access.ready && !access.canListUsers}
            title={
              access.ready && !access.canListUsers
                ? "Нужно право users.list — без списка учётных записей выбрать сотрудника не из чего"
                : undefined
            }
            onClick={() => setSheetOpen(true)}
          >
            <Plus className="mr-1.5 size-3.5" /> {t("newBinding")}
          </Button>
        )}
      </div>

      {access.ready && access.canManage && !access.canListUsers && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>Новую привязку отсюда завести не получится.</b> Форма выбирает
            сотрудника из реестра учётных записей, а он отдаётся по праву{" "}
            <code className="rounded bg-amber-100 px-1 py-px font-mono text-[11px] dark:bg-amber-900/50">
              users.list
            </code>{" "}
            — отдельному от{" "}
            <code className="rounded bg-amber-100 px-1 py-px font-mono text-[11px] dark:bg-amber-900/50">
              passport.mentors.manage
            </code>{" "}
            и не входящему с ним в один набор прав. Уже заведённые привязки
            видны и снимаются как обычно; новую заведёт администратор с этим
            правом — либо попросите добавить его вашей роли.
          </span>
        </div>
      )}

      <TelegramIdHelp className="mb-4" />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Сотрудник офиса",
                "Telegram ID",
                "Заходил в мини-апп",
                "Язык",
                "Привязан",
                "",
              ].map((h, i) => (
                <TableHead
                  key={i}
                  className="h-9 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* `!access.ready` counts as loading: the list query is disabled
                until the permission is known, and without this the table would
                flash "Наставников пока нет" at a screen that simply has not
                asked yet. */}
            {q.isLoading || !access.ready ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-[12.5px] text-muted-foreground"
                >
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : q.isError ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-[12.5px] text-destructive"
                >
                  {q.error?.status === 403
                    ? "Нет доступа к привязкам наставников."
                    : (q.error?.message ?? "Не удалось загрузить список")}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <p className="text-[13px] font-medium">
                    Наставников пока нет
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-muted-foreground">
                    Ни один управляющий пока не может открыть мини-апп паспорта.
                    Возьмите у него Telegram ID и нажмите «Привязать
                    наставника» — стажёры без наставника не смогут подтвердить
                    ни одной темы.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const inactiveUser =
                  row.user && row.user.status && row.user.status !== "active";
                return (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    <TableCell className="py-2 align-middle">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium">
                            {row.user?.name ?? userLabel(row.user ?? {})}
                          </span>
                          {row.banned && (
                            <Chip
                              tone="bad"
                              title="Аккаунт заблокирован в мини-аппе. Повторная привязка блокировку не снимает."
                            >
                              заблокирован
                            </Chip>
                          )}
                          {inactiveUser && (
                            <Chip
                              tone="warn"
                              title="Учётная запись в админке не активна — права наставника следуют за ней."
                            >
                              учётка {userStatusLabel(row.user?.status)}
                            </Chip>
                          )}
                          {!row.user && (
                            <Chip
                              tone="warn"
                              title="Привязка есть, а учётной записи за ней уже нет."
                            >
                              учётка не найдена
                            </Chip>
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {row.user?.login ?? "—"}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="py-2 align-middle font-mono text-[12.5px] tabular-nums">
                      {row.telegram_id}
                    </TableCell>
                    <TableCell className="py-2 align-middle">
                      {/* tg_first_name is filled by Telegram at the account's
                          first authentication — empty means the manager has
                          never actually got in, which is the question HR asks. */}
                      {row.tg_first_name ? (
                        <span className="flex items-center gap-1.5 text-[12.5px]">
                          <Chip tone="ok">заходил</Chip>
                          <span className="text-muted-foreground">
                            {row.tg_first_name}
                          </span>
                        </span>
                      ) : (
                        <Chip
                          tone="muted"
                          title="Telegram ещё ни разу не авторизовался этой привязкой. Проверьте, что ID верный и что менеджер открыл бота."
                        >
                          ещё не заходил
                        </Chip>
                      )}
                    </TableCell>
                    <TableCell className="py-2 align-middle text-[12.5px] uppercase text-muted-foreground">
                      {row.lang}
                    </TableCell>
                    <TableCell className="py-2 align-middle text-[12.5px] tabular-nums text-muted-foreground">
                      {fmtDate(row.created_at)}
                    </TableCell>
                    <TableCell className="py-2 text-right align-middle">
                      <UnbindButton row={row} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 px-1">
          <span className="text-[12px] tabular-nums text-muted-foreground">
            стр. {page + 1} из {pageCount} · всего: {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
          >
            Назад
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Вперёд
          </Button>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 px-1 text-[11.5px] leading-snug text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        Снятие привязки закрывает вход сразу, но не обрывает уже открытую
        сессию: она живёт до 12 часов. Планируйте отзыв доступа с этим окном.
      </p>

      <MentorSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
