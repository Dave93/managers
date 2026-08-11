"use client";

// «Начать стажировку» — the Sheet that turns an employee into a trainee.
//
// Three fields and one deliberate omission: there is no branch picker. The
// backend takes terminal_id from the employee record (controller.ts, the
// enrollment INSERT uses `emp.terminal_id`), so a branch HR cannot park a
// trainee in someone else's branch. The form shows which branch that will be,
// read-only, so the fact is visible rather than merely enforced.

import { useEffect, useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Info, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
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
import {
  createEnrollment,
  enrollmentConflict,
  type PassportEnrollmentConflict,
  type PassportEnrollmentCreated,
} from "@admin/lib/passport-api";

import { EmployeePicker } from "./employee-picker";
import { ENROLLMENT_STATUS_LABEL } from "./status";
import {
  apiMessage,
  fmtLongDate,
  qk,
  usePrograms,
  useTerminalNames,
  type EmployeeOption,
} from "./use-enrollments";

const PRESETS = [30, 60, 90];

export interface CreatedInvite extends PassportEnrollmentCreated {
  traineeName: string;
  position: string | null;
  programRu: string | null;
  programUz: string | null;
  branch: string;
}

/**
 * The 409 panel. Two shapes come back and they mean different things:
 *
 *  * in scope — the body names the existing enrollment (`enrollment_id`,
 *    `program_id`, `status`). HR can act on it, so the panel offers the two
 *    real moves: look at its journal, or find it in the table (where «Выдать
 *    новый QR» and «Завершить» live).
 *  * out of scope — the employee was transferred and their open enrollment
 *    belongs to a branch this user cannot see, so the backend deliberately
 *    withholds the ids. Offering buttons here would dead-end the user: /close
 *    and /reinvite on that enrollment both 403. The panel says what happened
 *    and who can fix it, and offers nothing else.
 *
 * Branch on the presence of `enrollment_id`, never on the prose.
 */
function ConflictPanel({
  conflict,
  programName,
  onShowInList,
  onOpenJournal,
}: {
  conflict: PassportEnrollmentConflict;
  programName: (id: string | undefined) => string;
  onShowInList: (enrollmentId: string) => void;
  onOpenJournal: (enrollmentId: string) => void;
}) {
  const inScope = !!conflict.enrollment_id;

  if (!inScope)
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>
          <b>У сотрудника уже есть открытая стажировка вне вашей зоны.</b>{" "}
          Похоже, его перевели, а стажировку по прежнему месту не закрыли: она
          вам не видна, ids сервер намеренно не отдал, и закрыть её отсюда
          нельзя — обратитесь в HQ, чтобы её завершили или перенесли, и
          повторите.
          {/* The generic 409 carries prose and nothing else. It is shown
              verbatim rather than swallowed: this branch is the one where our
              own interpretation is a guess, so the server's own words have to
              stay visible and quotable when HR calls HQ. */}
          <span className="mt-1.5 block border-l-2 border-amber-300 pl-2 font-mono text-[11px] leading-snug opacity-80 dark:border-amber-800">
            {conflict.message}
          </span>
        </span>
      </div>
    );

  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5">
      <div className="flex items-start gap-2 text-[12.5px] leading-snug">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          <b>У этого сотрудника уже идёт стажировка.</b> Один стажёр — один
          живой паспорт. Программа: «{programName(conflict.program_id)}»
          {conflict.status
            ? `, статус: ${ENROLLMENT_STATUS_LABEL[conflict.status].toLowerCase()}`
            : ""}
          . Чтобы начать новую, сначала завершите текущую; если человек просто
          потерял QR — выдайте новый код, а не новую стажировку.
        </span>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onShowInList(conflict.enrollment_id!)}
        >
          Показать её в списке
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onOpenJournal(conflict.enrollment_id!)}
        >
          Открыть журнал
        </Button>
      </div>
    </div>
  );
}

function EnrollmentForm({
  onClose,
  onCreated,
  onShowInList,
  onOpenJournal,
}: {
  onClose: () => void;
  onCreated: (invite: CreatedInvite) => void;
  onShowInList: (employeeId: string) => void;
  onOpenJournal: (enrollmentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const terminalName = useTerminalNames();
  const programs = usePrograms();
  const programsDenied = programs.isError && programs.error?.status === 403;
  const programList = useMemo(
    () => (programs.data?.data ?? []).filter((p) => p.active),
    [programs.data]
  );

  const [employee, setEmployee] = useState<EmployeeOption | null>(null);
  // `useTerminalNames` falls back to a truncated uuid when it cannot resolve a
  // branch; detecting that here keeps the uuid out of a sentence meant for a
  // human, without changing the helper other screens rely on.
  const branchLabel = employee ? terminalName(employee.terminal_id) : "";
  const branchKnown = !!employee && !branchLabel.endsWith("…") && branchLabel !== "—";
  const [conflict, setConflict] = useState<PassportEnrollmentConflict | null>(
    null
  );

  const form = useForm({
    defaultValues: { program_id: "", probation_days: 90 },
    onSubmit: async ({ value }) => save.mutate(value),
  });

  // A new employee means a new attempt: the previous refusal was about
  // somebody else and leaving it on screen would read as being about them.
  useEffect(() => setConflict(null), [employee?.id]);

  const save = useMutation({
    mutationFn: async (v: { program_id: string; probation_days: number }) => {
      const { data, error } = await createEnrollment({
        employee_id: employee!.id,
        program_id: v.program_id,
        probation_days: Number(v.probation_days),
      });
      if (error) {
        const c = (error as any)?.status === 409 ? enrollmentConflict(error) : null;
        if (c) {
          const e = new Error(c.message) as Error & {
            conflict: PassportEnrollmentConflict;
          };
          e.conflict = c;
          throw e;
        }
        throw new Error(apiMessage(error));
      }
      return data as PassportEnrollmentCreated;
    },
    onSuccess: (created) => {
      const program = programList.find(
        (p) => p.id === created.enrollment.program_id
      );
      queryClient.invalidateQueries({ queryKey: qk.enrollmentsAll });
      toast.success("Стажировка начата — распечатайте QR-инвайт");
      onCreated({
        ...created,
        traineeName: [employee?.last_name, employee?.first_name]
          .filter(Boolean)
          .join(" ")
          .trim(),
        position: employee?.position ?? null,
        programRu: program?.title_ru ?? null,
        programUz: program?.title_uz ?? null,
        branch: terminalName(created.enrollment.terminal_id),
      });
      onClose();
    },
    onError: (e: any) => {
      if (e?.conflict) {
        setConflict(e.conflict as PassportEnrollmentConflict);
        return;
      }
      toast.error(apiMessage(e));
    },
  });

  const programName = (id: string | undefined) => {
    if (!id) return "неизвестна";
    const hit = (programs.data?.data ?? []).find((p) => p.id === id);
    return hit ? hit.title_ru : "недоступна для просмотра";
  };

  const blocked = programsDenied;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-6 pb-4"
    >
      {programsDenied && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            Список программ недоступен — он отдаётся по праву{" "}
            <code className="font-mono text-[11px]">passport.matrix.view</code>,
            отдельному от права на стажировки. Без программы стажировку начать
            нельзя: попросите администратора добавить это право вашей роли.
          </span>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Сотрудник</Label>
        <EmployeePicker
          value={employee}
          onChange={setEmployee}
          terminalName={terminalName}
          disabled={blocked}
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          Филиал стажировки берётся из карточки сотрудника — выбрать другой
          нельзя.{" "}
          {employee && (
            <span className="text-foreground">
              {/* The employee registry (GET /attestation/employees) carries
                  terminal_id but no name, so this line depends on the cached
                  terminals registry — which a role without `terminals.list`
                  cannot read. Rather than print a truncated uuid at HR ("будет
                  открыта в филиале «e85de515…»", which names nothing and
                  suggests nothing), say the true thing: the branch comes from
                  the employee card either way, and the operator cannot change
                  it here. */}
              {branchKnown
                ? `Стажировка будет открыта в филиале «${branchLabel}».`
                : "Стажировка будет открыта в филиале, указанном в карточке этого сотрудника."}
            </span>
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Программа</Label>
        <form.Field name="program_id">
          {(field: any) => (
            <Select
              value={field.state.value || ""}
              onValueChange={field.handleChange}
              disabled={blocked || programs.isLoading || !programList.length}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    programs.isLoading
                      ? "загрузка…"
                      : programList.length
                        ? "Выберите программу"
                        : "Активных программ нет"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {programList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span>{p.position}</span>
                      <span className="text-muted-foreground">
                        {p.title_ru}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">
          Испытательный срок, дней
        </Label>
        <form.Field name="probation_days">
          {(field: any) => {
            const n = Number(field.state.value);
            const valid = Number.isFinite(n) && n >= 1 && n <= 365;
            return (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    inputMode="numeric"
                    value={field.state.value ?? ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className={cn(
                      "w-28 tabular-nums",
                      !valid && "border-destructive"
                    )}
                    disabled={blocked}
                  />
                  <div className="flex gap-1">
                    {PRESETS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={n === d ? "secondary" : "ghost"}
                        className="h-8 px-2 text-[12px]"
                        onClick={() => field.handleChange(d)}
                        disabled={blocked}
                      >
                        {d}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <CalendarClock className="size-3.5" />
                  {valid ? (
                    <>
                      Дедлайн испытательного:{" "}
                      <span className="font-medium text-foreground">
                        {fmtLongDate(Date.now() + n * 86400_000)}
                      </span>
                    </>
                  ) : (
                    <span className="text-destructive">
                      Допустимо от 1 до 365 дней.
                    </span>
                  )}
                </p>
              </>
            );
          }}
        </form.Field>
      </div>

      {conflict && (
        <ConflictPanel
          conflict={conflict}
          programName={programName}
          onShowInList={() => {
            onShowInList(employee!.id);
            onClose();
          }}
          onOpenJournal={(id) => {
            onOpenJournal(id);
            onClose();
          }}
        />
      )}

      <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-[11.5px] leading-snug text-muted-foreground">
        Сразу после создания откроется страница QR-инвайта. Код одноразовый и
        действует 7 дней — распечатайте и отдайте его стажёру в тот же день.
      </div>

      {/* Subscribes to the whole `values` object (the idiom the curriculum
          builder's topic-sheet.tsx uses): react-form types the child as
          `(state: TSelected) => ReactNode`, and a tuple parameter against an
          inferred `any[]` selection is a compile error ("target requires N
          element(s) but source may have fewer").

          probation_days is re-validated HERE, with the same 1..365 predicate
          the field draws in red. The field alone only coloured the input, so an
          out-of-range value still submitted and came back as a raw Elysia 422
          in a toast — the server's schema message, written for a developer,
          shown to HR. The gate belongs on the button too. */}
      <form.Subscribe selector={(s: any) => s.values}>
        {(values: any) => {
          const programId = values?.program_id;
          const days = Number(values?.probation_days);
          const daysValid = Number.isFinite(days) && days >= 1 && days <= 365;
          return (
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  blocked ||
                  !employee ||
                  !programId ||
                  !daysValid
                }
              >
                {save.isPending && (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                )}
                Начать и выдать QR
              </Button>
            </div>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

export function EnrollmentSheet({
  open,
  onOpenChange,
  onCreated,
  onShowInList,
  onOpenJournal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (invite: CreatedInvite) => void;
  onShowInList: (employeeId: string) => void;
  onOpenJournal: (enrollmentId: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-8 sm:max-w-xl">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle>Начать стажировку</SheetTitle>
          <SheetDescription className="text-[12.5px] leading-snug">
            Сотрудник получит свой паспорт стажёра в Telegram — темы, сроки и
            отметки наставника.
          </SheetDescription>
        </SheetHeader>
        {/* Unmounted when closed, so every open starts from a clean form and a
            cleared 409 — the house pattern used by every components/forms
            sheet.tsx in this admin. */}
        {open && (
          <EnrollmentForm
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
            onShowInList={onShowInList}
            onOpenJournal={onOpenJournal}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
