"use client";

// Панель исполнителя: создание, правка, состояние привязки к боту и выдача
// ссылки-приглашения. Работает только с внешними людьми фирмы: kind и
// contractor_id задаёт хук создания, поля user_id в форме нет.
//
// Четыре состояния привязки читаются из двух полей строки сразу, потому что
// каждое из них в одиночку врёт:
//  * tg_user_id есть, invite_used_at есть   → привязан, с датой;
//  * tg_user_id есть, invite_used_at пуст   → привязан, но выдана новая
//    ссылка, и её ещё не открыли (выдача сбрасывает invite_used_at и НЕ
//    трогает tg_user_id, заявки продолжают идти старому аккаунту);
//  * tg_user_id пуст, invite_used_at есть   → код израсходован, а аккаунт не
//    записан: привязка не завершена, «Привязан» тут было бы неправдой;
//  * оба пусты                              → не привязан.
//
// Ссылку отдаёт только POST /ticket_executors/:id/invite (в строках списка
// invite_code вырезан). Она лежит в состоянии тела панели и нигде больше.

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Switch } from "@components/ui/switch";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { cn } from "@admin/lib/utils";
import { apiMessage, type ApiError, type ContractorRow, type ExecutorRow, type ExecutorUpdateInput } from "@admin/lib/tickets-api";
import { parseTs } from "@admin/components/tickets/status";

import {
  CONTRACTORS_RIGHT,
  mutationErrorText,
  useExecutorActions,
  useIssueInvite,
  useSheetSession,
} from "./use-contractors";

// ---------------------------------------------------------------------------
// привязка к боту
// ---------------------------------------------------------------------------

export type Binding = "bound" | "bound_relink" | "half" | "none";

export function bindingOf(row: Pick<ExecutorRow, "tg_user_id" | "invite_used_at">): Binding {
  const hasTg = row.tg_user_id !== null && row.tg_user_id !== undefined;
  const hasUsed = Boolean(row.invite_used_at);
  if (hasTg) return hasUsed ? "bound" : "bound_relink";
  return hasUsed ? "half" : "none";
}

// parseTs, а не new Date(s.replace(" ", "T")): на строках Postgres со смещением
// «+00» второй вариант даёт NaN.
export function fmtTs(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = parseTs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CHIP = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight";

export function BindingChip({ row }: { row: Pick<ExecutorRow, "tg_user_id" | "invite_used_at"> }) {
  const b = bindingOf(row);
  const label =
    b === "bound"
      ? "Привязан к боту"
      : b === "bound_relink"
        ? "Привязан, новая ссылка не открыта"
        : b === "half"
          ? "Привязка не завершена"
          : "Не привязан";
  const tone =
    b === "bound"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : b === "none"
        ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return <span className={cn(CHIP, tone)}>{label}</span>;
}

export function BindingStatus({
  row,
}: {
  row: Pick<ExecutorRow, "tg_user_id" | "invite_used_at">;
}) {
  const b = bindingOf(row);
  const when = fmtTs(row.invite_used_at);
  return (
    <section aria-label="Привязка к боту" className="space-y-1.5">
      <h4 className="text-sm font-medium">Привязка к боту</h4>
      <div className="space-y-1">
        <BindingChip row={row} />
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {b === "bound" &&
            (when ? `Ссылка открыта ${when}.` : "Ссылка открыта, время не определено.")}
          {b === "bound_relink" &&
            "Аккаунт Telegram записан. После этого выдана новая ссылка, её ещё не открыли. Пока её не откроют, привязка остаётся за прежним аккаунтом."}
          {b === "half" &&
            `Код приглашения использован${when ? ` ${when}` : ""}, но аккаунт Telegram не записан. Заявки этому человеку не приходят. Выдайте ссылку заново.`}
          {b === "none" && "Ссылка ещё не открыта, заявки в бот этому человеку не приходят."}
        </p>
        {row.tg_user_id !== null && row.tg_user_id !== undefined && (
          <p className="font-mono text-[11px] text-muted-foreground">
            Telegram ID: {row.tg_user_id}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// выдача ссылки
// ---------------------------------------------------------------------------

export type InviteErrorKind = "bot_missing" | "forbidden" | "network" | "other";

// Бэкенд отвечает 500 с текстом про «бот приглашений не настроен» ДО того, как
// меняет код, так что прежняя ссылка при этом жива. Но 500 бывает и по другим
// причинам (база недоступна), и называть их «бот не настроен» значило бы
// отправить администратора чинить не то. Поэтому смотрим на статус вместе с
// текстом, а не на один статус.
export function classifyInviteError(error: unknown): InviteErrorKind {
  const status = (error as ApiError | null)?.status;
  if (status === undefined) return "network";
  if (status === 403) return "forbidden";
  if (status === 500 && /не настроен/i.test(apiMessage(error))) return "bot_missing";
  return "other";
}

export type InviteView =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "done"; link: string }
  | { phase: "error"; kind: InviteErrorKind; message: string };

export type CopyState = "idle" | "ok" | "failed" | "unavailable";

// navigator.clipboard есть только в безопасном контексте (https или localhost);
// на http он undefined, а Safari может отказать вне жеста пользователя.
// Обещать «скопировано» нельзя, пока writeText не отработал.
export async function copyToClipboard(text: string): Promise<Exclude<CopyState, "idle">> {
  if (typeof window === "undefined" || !window.isSecureContext || !navigator.clipboard?.writeText) {
    return "unavailable";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "ok";
  } catch {
    return "failed";
  }
}

function CopyNote({ copy }: { copy: CopyState }) {
  if (copy === "ok") {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
        <Check className="size-3.5" /> Ссылка скопирована в буфер обмена.
      </p>
    );
  }
  if (copy === "failed") {
    return (
      <p className="text-[12px] leading-snug text-destructive">
        Не удалось скопировать в буфер обмена. Выделите ссылку в поле выше и скопируйте вручную.
      </p>
    );
  }
  if (copy === "unavailable") {
    return (
      <p className="text-[12px] leading-snug text-destructive">
        Буфер обмена недоступен в этом соединении (нужен https). Выделите ссылку в поле выше и
        скопируйте вручную.
      </p>
    );
  }
  return null;
}

export function InvitePanel({
  row,
  view,
  copy,
  onIssue,
  onCopy,
}: {
  row: Pick<ExecutorRow, "tg_user_id" | "is_active" | "full_name">;
  view: InviteView;
  copy: CopyState;
  onIssue: () => void;
  onCopy: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const bound = row.tg_user_id !== null && row.tg_user_id !== undefined;
  const pending = view.phase === "pending";
  const blocked = !row.is_active;
  const linkId = useId();

  // Привязанного человека без подтверждения не трогаем: выдача новой ссылки
  // отдаёт место в боте тому, кто её откроет.
  const press = () => (bound ? setConfirmOpen(true) : onIssue());

  return (
    <section aria-label="Приглашение в бот" className="space-y-2.5">
      <h4 className="text-sm font-medium">Приглашение в бот</h4>

      <div
        role="note"
        className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Новая ссылка гасит предыдущую: если прежнюю уже отправили человеку и он её не открыл,
            она перестанет работать. Каждая ссылка одноразовая.
            {view.phase === "done" && " Ссылка на экране тоже погаснет."}
          </span>
        </p>
        {bound && (
          <p className="pl-5">
            {row.full_name} уже привязан к боту. Привязка не пропадёт сразу, но тот, кто откроет
            новую ссылку, займёт его место: заявки пойдут на аккаунт Telegram, с которого её
            открыли. Выдавайте её, только если человека нужно перепривязать.
          </p>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={press}
        disabled={blocked || pending}
        aria-busy={pending}
      >
        <KeyRound className="size-3.5" />
        {pending ? "Выдаём ссылку…" : "Пригласить в бот"}
      </Button>
      {blocked && (
        <p className="text-[12px] leading-snug text-muted-foreground">
          Исполнитель выключен: бот не привяжет выключенного, и ссылка не сработает. Включите его и
          сохраните, затем приглашайте.
        </p>
      )}

      <div aria-live="polite" className="space-y-2">
        {view.phase === "done" && (
          <div className="space-y-2">
            <Label htmlFor={linkId}>Ссылка-приглашение</Label>
            <div className="flex gap-2">
              <Input
                id={linkId}
                readOnly
                value={view.link}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-[12px]"
              />
              <Button type="button" variant="outline" onClick={onCopy} className="shrink-0">
                <Copy className="size-3.5" />
                Скопировать
              </Button>
            </div>
            <CopyNote copy={copy} />
            <p className="text-[12px] leading-snug text-muted-foreground">
              Перешлите ссылку человеку вручную. Её видно только пока открыта эта панель: после
              закрытия она не сохраняется, придётся выдавать новую.
            </p>
          </div>
        )}
        {view.phase === "error" && (
          <div role="alert" className="space-y-1">
            <p className="text-[13px] font-medium text-destructive">
              {view.kind === "bot_missing"
                ? "Бот не настроен, обратитесь к администратору"
                : view.kind === "forbidden"
                  ? "Нет доступа"
                  : view.kind === "network"
                    ? "Нет связи с сервером"
                    : "Не удалось выдать ссылку"}
            </p>
            <p className="break-words text-[12px] leading-snug text-muted-foreground">
              {view.kind === "bot_missing" &&
                "Сервер не знает имя бота для приглашений. Прежняя ссылка не затронута."}
              {view.kind === "forbidden" &&
                `Нужно право ${CONTRACTORS_RIGHT}. Попросите администратора добавить его вашей роли.`}
              {view.kind === "network" &&
                "Неизвестно, дошёл ли запрос. Если дошёл, прежняя ссылка уже не работает. Проверьте статус привязки выше и выдайте ссылку ещё раз."}
              {view.kind === "other" && view.message}
            </p>
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выдать новую ссылку для {row.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Человек уже привязан к боту. Прежняя ссылка погаснет, а тот, кто откроет новую,
              получит заявки вместо него. Продолжайте, только если его нужно перепривязать.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Не сейчас</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onIssue();
              }}
            >
              Выдать ссылку
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// язык
// ---------------------------------------------------------------------------

type Lang = "ru" | "uz";

// Бот различает ровно эти два значения: pick() в messages.ts отдаёт узбекский
// только на "uz", а resolveBindLang в bot-controller.ts принимает "ru" и "uz".
// Любая другая строка в колонке читается ботом как русский.
const LANGS: Array<{ value: Lang; label: string }> = [
  { value: "ru", label: "Русский" },
  { value: "uz", label: "Oʻzbekcha" },
];

export function LangToggle({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: Lang;
  onChange: (v: Lang) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="inline-flex rounded-md border p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          role="radio"
          aria-checked={value === l.value}
          disabled={disabled}
          onClick={() => onChange(l.value)}
          className={cn(
            "rounded-[5px] px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
            value === l.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export const langOf = (value: string | null | undefined): Lang => (value === "uz" ? "uz" : "ru");

// ---------------------------------------------------------------------------
// панель
// ---------------------------------------------------------------------------

export type ExecutorTarget = { kind: "create" } | { kind: "edit"; id: string };

export function ExecutorSheet({
  target,
  contractor,
  executors,
  onClose,
}: {
  target: ExecutorTarget | null;
  // Фирма, к которой относится панель: создание идёт в неё, в заголовке её имя.
  contractor: ContractorRow | null;
  executors: ExecutorRow[];
  onClose: () => void;
}) {
  const { shown, epoch } = useSheetSession(target);
  const row = shown?.kind === "edit" ? (executors.find((x) => x.id === shown.id) ?? null) : null;
  // Пока ссылка выдаётся, закрыть панель нельзя: ответ с кодом, который
  // сервер уже выписал, пришёл бы в размонтированное тело и пропал, а
  // прежняя ссылка к этому моменту уже погашена.
  const [locked, setLocked] = useState(false);

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && !locked && onClose()}>
      <SheetContent
        className="w-full gap-0 p-0 sm:max-w-md"
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onInteractOutside={(e) => locked && e.preventDefault()}
      >
        {shown !== null && (
          <ExecutorBody
            key={`${shown.kind === "edit" ? shown.id : "new"}:${epoch}`}
            mode={shown.kind}
            row={row}
            contractor={contractor}
            onClose={onClose}
            onLock={setLocked}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ExecutorBody({
  mode,
  row,
  contractor,
  onClose,
  onLock,
}: {
  mode: "create" | "edit";
  row: ExecutorRow | null;
  contractor: ContractorRow | null;
  onClose: () => void;
  onLock: (locked: boolean) => void;
}) {
  const ids = { name: useId(), phone: useId(), lang: useId(), active: useId() };
  const actions = useExecutorActions();
  const issue = useIssueInvite();
  const [copy, setCopy] = useState<CopyState>("idle");
  // Живое состояние выдачи для колбэков, которые переживают рендер. Замыкание
  // submit видит isPending/isSuccess того рендера, где его создали, и устарело
  // к моменту ответа на сохранение. Ref выставляется в момент нажатия и в
  // колбэках самой мутации, а не из рендера.
  const inviteLive = useRef<"idle" | "pending" | "done">("idle");

  useEffect(() => {
    onLock(issue.isPending);
    return () => onLock(false);
  }, [issue.isPending, onLock]);

  const [initial, setInitial] = useState(() => ({
    name: row?.full_name ?? "",
    phone: row?.phone ?? "",
    lang: langOf(row?.lang),
    active: row?.is_active ?? true,
  }));
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [active, setActive] = useState(initial.active);
  const [touched, setTouched] = useState(false);

  const mutation = mode === "create" ? actions.create : actions.update;
  const pending = mutation.isPending;

  if (mode === "edit" && row === null) {
    return (
      <>
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <SheetTitle className="text-base">Исполнитель</SheetTitle>
          <SheetDescription className="sr-only">Правка исполнителя</SheetDescription>
        </SheetHeader>
        <div role="alert" className="flex items-start gap-3 px-5 py-6">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[12.5px] leading-snug text-muted-foreground">
            Исполнитель не найден в загруженном списке. Закройте панель и обновите страницу.
          </p>
        </div>
      </>
    );
  }

  const trimmed = { name: name.trim(), phone: phone.trim() };
  const patch: ExecutorUpdateInput = {};
  if (trimmed.name !== initial.name) patch.full_name = trimmed.name;
  if (trimmed.phone !== initial.phone) patch.phone = trimmed.phone;
  if (lang !== initial.lang) patch.lang = lang;
  if (active !== initial.active) patch.is_active = active;
  const dirty = Object.keys(patch).length > 0;
  const nameMissing = trimmed.name === "";
  const noFirm = mode === "create" && contractor === null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || nameMissing || noFirm) return;
    if (mode === "create" && contractor) {
      actions.create.mutate(
        {
          contractorId: contractor.id,
          full_name: trimmed.name,
          ...(trimmed.phone ? { phone: trimmed.phone } : {}),
          lang,
        },
        { onSuccess: onClose }
      );
    } else if (row && dirty) {
      actions.update.mutate(
        { id: row.id, body: patch },
        {
          onSuccess: () => {
            // Сохранение зовёт onClose страницы напрямую, мимо замка в
            // ExecutorSheet, поэтому решает сам: пока ссылка выдаётся или уже
            // на экране, панель не закрывается, иначе одноразовая ссылка
            // пропала бы вместе с ней (сервер к этому моменту код уже
            // провернул). Работает в обе стороны порядка: приглашение до
            // сохранения и сохранение до приглашения, потому что читается
            // живой ref, а не isSuccess из замыкания.
            if (inviteLive.current !== "idle") {
              setInitial({
                name: trimmed.name,
                phone: trimmed.phone,
                lang,
                active,
              });
            } else {
              onClose();
            }
          },
        }
      );
    }
  };

  const view: InviteView = issue.isPending
    ? { phase: "pending" }
    : issue.isError
      ? {
          phase: "error",
          kind: classifyInviteError(issue.error),
          message: apiMessage(issue.error),
        }
      : issue.isSuccess
        ? { phase: "done", link: issue.data.link }
        : { phase: "idle" };

  const doCopy = async (link: string) => setCopy(await copyToClipboard(link));
  const onIssue = () => {
    if (!row || issue.isPending) return;
    setCopy("idle");
    inviteLive.current = "pending";
    issue.mutate(row.id, {
      onSuccess: (r) => {
        inviteLive.current = "done";
        void doCopy(r.link);
      },
      onError: () => {
        inviteLive.current = "idle";
      },
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
        <SheetTitle className="text-base">
          {mode === "create" ? "Новый исполнитель" : initial.name || "Исполнитель"}
        </SheetTitle>
        <SheetDescription className="text-[12px]">
          {contractor ? `Фирма «${contractor.name}»` : "Фирма не выбрана"}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {noFirm && (
          <p role="alert" className="text-[12.5px] text-destructive">
            Сначала выберите фирму.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={ids.name}>Имя</Label>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            maxLength={200}
            autoComplete="off"
            aria-invalid={touched && nameMissing}
            disabled={pending}
          />
          {touched && nameMissing && (
            <p className="text-[12px] text-destructive">Имя обязательно.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.phone}>Телефон</Label>
          <Input
            id={ids.phone}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <span id={ids.lang} className="text-sm font-medium leading-none">
            Язык сообщений бота
          </span>
          <div>
            <LangToggle value={lang} onChange={setLang} disabled={pending} labelledBy={ids.lang} />
          </div>
          {row && row.lang !== "ru" && row.lang !== "uz" && (
            <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-400">
              В карточке записано «{row.lang}»: бот читает это как русский.
            </p>
          )}
        </div>
        {mode === "edit" && (
          <div className="space-y-1.5 rounded-md border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={ids.active}>Исполнитель активен</Label>
              <Switch
                id={ids.active}
                checked={active}
                onCheckedChange={setActive}
                disabled={pending}
              />
            </div>
            <p className="text-[12px] leading-snug text-muted-foreground">
              Выключенному заявки в бот не приходят, и привязать его по ссылке нельзя.
            </p>
          </div>
        )}
        {mutation.error ? (
          <p role="alert" className="break-words text-[12.5px] leading-snug text-destructive">
            {mutationErrorText(mutation.error)}
          </p>
        ) : mode === "edit" && mutation.isSuccess && !dirty ? (
          <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-400">
            Сохранено.
          </p>
        ) : null}

        {mode === "edit" && row && (
          <>
            <hr className="border-border" />
            <BindingStatus row={row} />
            <InvitePanel
              row={row}
              view={view}
              copy={copy}
              onIssue={onIssue}
              onCopy={() => view.phase === "done" && void doCopy(view.link)}
            />
          </>
        )}
        {mode === "create" && (
          <p className="text-[12px] leading-snug text-muted-foreground">
            Приглашение в бот можно выдать после сохранения: откройте исполнителя из списка.
          </p>
        )}
      </div>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose} disabled={issue.isPending}>
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={pending || nameMissing || noFirm || (mode === "edit" && !dirty)}
        >
          {pending ? "Сохраняем…" : mode === "create" ? "Создать" : "Сохранить"}
        </Button>
      </SheetFooter>
    </form>
  );
}
