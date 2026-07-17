"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type Stage = "pick_test" | "pick_employee" | "pin" | "quiz" | "result";
type Question = {
  id: string;
  text: string;
  type: "single" | "multi";
  options: { id: string; text: string }[];
};

export default function KioskPage() {
  const t = useTranslations("attestation");
  const [stage, setStage] = useState<Stage>("pick_test");
  const [testId, setTestId] = useState<string>();
  const [employeeId, setEmployeeId] = useState<string>();
  const [pin, setPin] = useState("");
  const [attemptId, setAttemptId] = useState<string>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [result, setResult] = useState<{
    score: number;
    passed: boolean;
    expired: boolean;
  }>();

  const { data: tests } = useQuery({
    queryKey: ["kiosk_tests"],
    queryFn: () =>
      apiClient.api.attestation.tests.get({
        query: { limit: "100", offset: "0", fields: "id,title,active" },
      }),
  });
  const { data: employees } = useQuery({
    queryKey: ["kiosk_employees"],
    queryFn: () =>
      apiClient.api.attestation.employees.get({
        query: { limit: "500", offset: "0" },
      }),
  });

  const submit = async () => {
    if (!attemptId) return;
    const payload = {
      answers: questions.map((q) => ({
        question_id: q.id,
        selected_option_ids: answers[q.id] ?? [],
      })),
    };
    const res: any = await apiClient.api.attestation
      .attempts({ id: attemptId })
      .submit.post({ data: payload });
    if (res.error) {
      toast.error(res.error.value?.message ?? t("kiosk.submitError"));
      return;
    }
    setResult(res.data);
    setDeadline(null);
    setStage("result");
  };

  // countdown (display only; server is authoritative)
  useEffect(() => {
    if (deadline == null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void submit();
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  const start = async () => {
    const res: any = await apiClient.api.attestation.attempts.start.post({
      data: { test_id: testId!, employee_id: employeeId!, pin },
    });
    if (res.error) {
      toast.error(res.error.value?.message ?? t("kiosk.startError"));
      return;
    }
    const d = res.data;
    setAttemptId(d.attempt_id);
    setQuestions(d.questions);
    if (d.time_limit_minutes)
      setDeadline(
        new Date(d.started_at).getTime() + d.time_limit_minutes * 60_000
      );
    setStage("quiz");
  };

  const toggle = (q: Question, optionId: string) => {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === "single") return { ...prev, [q.id]: [optionId] };
      return {
        ...prev,
        [q.id]: cur.includes(optionId)
          ? cur.filter((x) => x !== optionId)
          : [...cur, optionId],
      };
    });
  };

  const reset = () => {
    setStage("pick_test");
    setTestId(undefined);
    setEmployeeId(undefined);
    setPin("");
    setAttemptId(undefined);
    setQuestions([]);
    setAnswers({});
    setResult(undefined);
  };

  const activeTests = ((tests as any)?.data?.data ?? []).filter(
    (x: any) => x.active
  );
  const roster = (employees as any)?.data?.data ?? [];
  const selectedTest = activeTests.find((x: any) => x.id === testId);
  const selectedEmployee = roster.find((e: any) => e.id === employeeId);
  const contextLine = [
    selectedTest?.title,
    selectedEmployee
      ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-8 overflow-auto">
      <div className="w-full max-w-2xl space-y-6">
        {stage === "pick_test" && (
          <>
            <h1 className="text-2xl font-bold">{t("kiosk.pickTest")}</h1>
            <div className="grid gap-2">
              {activeTests.map((x: any) => (
                <Button
                  key={x.id}
                  variant="outline"
                  onClick={() => {
                    setTestId(x.id);
                    setStage("pick_employee");
                  }}
                >
                  {x.title}
                </Button>
              ))}
            </div>
          </>
        )}

        {stage === "pick_employee" && (
          <>
            <h1 className="text-2xl font-bold">{t("kiosk.pickEmployee")}</h1>
            {contextLine && (
              <p className="text-muted-foreground">{contextLine}</p>
            )}
            <div className="grid gap-2 max-h-[60vh] overflow-auto">
              {roster.map((e: any) => (
                <Button
                  key={e.id}
                  variant="outline"
                  onClick={() => {
                    setEmployeeId(e.id);
                    setStage("pin");
                  }}
                >
                  {e.first_name} {e.last_name} — {e.position}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setTestId(undefined);
                setStage("pick_test");
              }}
            >
              ← {t("kiosk.back")}
            </Button>
          </>
        )}

        {stage === "pin" && (
          <>
            <h1 className="text-2xl font-bold">{t("kiosk.enterPin")}</h1>
            {contextLine && (
              <p className="text-muted-foreground">{contextLine}</p>
            )}
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-2xl tracking-widest"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEmployeeId(undefined);
                  setPin("");
                  setStage("pick_employee");
                }}
              >
                ← {t("kiosk.back")}
              </Button>
              <Button variant="outline" onClick={reset}>
                {t("kiosk.cancel")}
              </Button>
              <Button onClick={start} disabled={!pin}>
                {t("kiosk.start")}
              </Button>
            </div>
          </>
        )}

        {stage === "quiz" && (
          <>
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold">{t("kiosk.test")}</h1>
                {contextLine && (
                  <p className="text-muted-foreground text-sm">{contextLine}</p>
                )}
              </div>
              {remaining != null && (
                <span className="text-lg font-mono">
                  {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </span>
              )}
            </div>
            {questions.map((q, i) => (
              <div key={q.id} className="border rounded-md p-4 space-y-2">
                <p className="font-medium">
                  {i + 1}. {q.text}
                </p>
                {q.options.map((o) => {
                  const selected = (answers[q.id] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(q, o.id)}
                      className={`block w-full text-left px-3 py-2 rounded border ${
                        selected ? "bg-primary text-primary-foreground" : ""
                      }`}
                    >
                      {o.text}
                    </button>
                  );
                })}
              </div>
            ))}
            <Button onClick={submit} className="w-full">
              {t("kiosk.finish")}
            </Button>
          </>
        )}

        {stage === "result" && result && (
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold">
              {result.passed ? `✅ ${t("kiosk.passed")}` : `❌ ${t("kiosk.failed")}`}
            </h1>
            <p className="text-xl">
              {t("kiosk.score")}: {result.score}%
            </p>
            {result.expired && (
              <p className="text-destructive">{t("kiosk.timeExpired")}</p>
            )}
            <Button onClick={reset}>{t("kiosk.done")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
