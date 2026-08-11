"use client";

// Binding an office account to a Telegram account.
//
// Sheet, not Dialog — the house rule for create/edit in this admin. Form state
// through @tanstack/react-form (react-hook-form is abandoned here and is not
// used anywhere in this section).
//
// POST /passport/mentors is idempotent per office user: re-binding the same
// user REPLACES their telegram id and comes back `created:false`. Two things
// that follows from, both surfaced in the UI rather than left as folklore:
//  * the confirmation copy has to differ ("привязан" vs "Telegram заменён"),
//    otherwise HR cannot tell whether they just moved someone's access;
//  * `banned` is deliberately NOT cleared by a re-bind — un-banning is its own
//    decision, and this surface has no endpoint for it.
//
// Three refusals matter and all three are actionable, so none of them is
// allowed to collapse into a generic toast (codes read with refusalCode()):
//   user_not_found              — the office account is gone
//   telegram_bound_to_trainee   — that phone is a TRAINEE's; binding it would
//                                 cost the trainee their passport and hand
//                                 sign-off reach to whoever holds the phone
//   telegram_bound_to_other_user— unbind it from the other user first

import { useEffect, useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Loader2,
  Search,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { cn } from "@admin/lib/utils";
import { createMentor, refusalCode } from "@admin/lib/passport-api";

import { TelegramIdHelp } from "./telegram-id-help";
import {
  apiMessage,
  qk,
  useOfficeUsers,
  userLabel,
  type OfficeUser,
} from "./use-mentors";

function UserPicker({
  value,
  onChange,
  disabled,
}: {
  value: OfficeUser | null;
  onChange: (u: OfficeUser | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useOfficeUsers(open);
  // `users.list` is a separate permission from passport.mentors.manage and no
  // seed grants them together — a 403 here is a real configuration, not an
  // edge case, and an empty dropdown would be a lie.
  const denied = q.isError && q.error?.status === 403;

  const rows = useMemo(() => {
    const list = q.data ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return list;
    return list.filter((u) =>
      [u.first_name, u.last_name, u.login]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [q.data, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto w-full justify-between px-3 py-2 text-left font-normal"
        >
          {value ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">
                {userLabel(value)}
              </span>
              <span className="truncate text-[11.5px] text-muted-foreground">
                {value.login ?? "без логина"}
              </span>
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground">
              Выберите сотрудника офиса
            </span>
          )}
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Имя или логин"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto p-1">
          {denied ? (
            <p className="flex items-start gap-2 px-2 py-3 text-[12px] leading-snug text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              Список сотрудников офиса отдаётся по праву{" "}
              <code className="font-mono text-[11px]">users.list</code>, а у
              вашей роли его нет. Попросите администратора добавить право или
              привязать наставника за вас.
            </p>
          ) : q.isLoading ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Загрузка…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">
              Никого не нашлось.
            </p>
          ) : (
            rows.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onChange(u);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent",
                  value?.id === u.id && "bg-accent/60"
                )}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    value?.id === u.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px]">{userLabel(u)}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {u.login ?? "без логина"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface Refusal {
  code: string;
  message: string;
  hint: string;
}

function describeRefusal(error: any): Refusal | null {
  const code = refusalCode(error);
  if (!code) return null;
  if (code === "user_not_found")
    return {
      code,
      message: "Такого сотрудника офиса больше нет.",
      hint: "Учётную запись удалили или она была выбрана из устаревшего списка. Закройте форму, откройте заново и выберите ещё раз.",
    };
  if (code === "telegram_bound_to_trainee")
    return {
      code,
      message: "Этот Telegram принадлежит стажёру.",
      hint: "Привязать его как наставника нельзя: аккаунт перестал бы быть стажёрским, стажёр потерял бы свой паспорт, а тот, у кого этот телефон в руках, получил бы право подписывать чужие темы. Проверьте, не продиктовал ли менеджер ID со своего рабочего телефона, на котором заходит стажёр.",
    };
  if (code === "telegram_bound_to_other_user")
    return {
      code,
      message: "Этот Telegram уже привязан к другому сотруднику офиса.",
      hint: "Один Telegram — один аккаунт. Снимите ту привязку в таблице и повторите.",
    };
  return null;
}

function MentorForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<OfficeUser | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const form = useForm({
    defaultValues: { telegram_id: "", lang: "ru" as "ru" | "uz" },
    onSubmit: async ({ value }) => save.mutate(value),
  });

  // A fresh refusal is only meaningful for the input that produced it.
  useEffect(() => setRefusal(null), [user]);

  const save = useMutation({
    mutationFn: async (v: { telegram_id: string; lang: "ru" | "uz" }) => {
      if (!user) throw new Error("Выберите сотрудника офиса");
      const tg = Number(String(v.telegram_id).trim());
      if (!Number.isSafeInteger(tg) || tg <= 0)
        throw new Error(
          "Telegram ID — это целое положительное число, например 123456789"
        );
      const { data, error } = await createMentor({
        user_id: user.id,
        telegram_id: tg,
        lang: v.lang,
      });
      if (error) {
        const e = new Error(apiMessage(error)) as any;
        e.value = (error as any)?.value;
        throw e;
      }
      return data!;
    },
    onSuccess: (binding) => {
      toast.success(
        binding.created
          ? "Наставник привязан"
          : "Telegram у этого сотрудника заменён"
      );
      if (!binding.created && binding.banned)
        toast.warning(
          "Привязка была заблокирована и осталась заблокированной — повторная привязка не снимает блокировку."
        );
      queryClient.invalidateQueries({ queryKey: qk.mentorsAll });
      onClose();
    },
    onError: (e: any) => {
      const r = describeRefusal(e);
      if (r) setRefusal(r);
      else toast.error(apiMessage(e));
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-6 pb-4"
    >
      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Сотрудник офиса</Label>
        <UserPicker value={user} onChange={setUser} disabled={save.isPending} />
        <p className="text-[11px] text-muted-foreground">
          Учётная запись этой админки — как правило, управляющий филиалом. Права
          наставника в мини-аппе следуют за правами и филиалами этой учётки.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Telegram ID</Label>
        <form.Field name="telegram_id">
          {(field: any) => (
            <Input
              value={field.state.value ?? ""}
              inputMode="numeric"
              autoComplete="off"
              placeholder="123456789"
              onChange={(e) =>
                // Digits only: a pasted "@ivanov" or "+998…" is the classic
                // wrong answer here, and silently sending it would 422.
                field.handleChange(e.target.value.replace(/[^\d]/g, ""))
              }
            />
          )}
        </form.Field>
        <TelegramIdHelp compact />
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Язык мини-аппа</Label>
        <form.Field name="lang">
          {(field: any) => (
            <Select
              value={field.state.value ?? "ru"}
              onValueChange={(v) => field.handleChange(v)}
            >
              <SelectTrigger className="h-9 w-[200px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ru">Русский</SelectItem>
                <SelectItem value="uz">O‘zbekcha</SelectItem>
              </SelectContent>
            </Select>
          )}
        </form.Field>
        <p className="text-[11px] text-muted-foreground">
          На каком языке наставник увидит темы и подтверждения. Менять можно
          повторной привязкой того же Telegram.
        </p>
      </div>

      {refusal && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            <b>{refusal.message}</b>
            <br />
            {refusal.hint}
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={save.isPending}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={save.isPending || !user}>
          {save.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          Привязать
        </Button>
      </div>
    </form>
  );
}

export function MentorSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-8 sm:max-w-lg">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle>Привязать наставника</SheetTitle>
          <SheetDescription className="text-[12.5px] leading-snug">
            Пока привязки нет, управляющий не откроет мини-апп паспорта вообще:
            стажёр входит по QR-инвайту, а у наставника QR не бывает.
          </SheetDescription>
        </SheetHeader>
        {open && <MentorForm onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}
