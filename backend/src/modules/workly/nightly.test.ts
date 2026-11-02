import { describe, expect, it, spyOn } from "bun:test";
import { KpiError } from "../kpi/errors";
import { WorklyError } from "./client";
import { failedJobCode, handleWorklyJob, jobFailureCode, nightlySteps, WORKLY_NIGHTLY_JOB, worklyJobProcessor } from "./nightly";
import { WORKLY_RUN_JOB } from "./queue";

const conn = (key: "LES" | "CHOPAR", hasApplied: boolean, configured: boolean) => ({ key, hasApplied, configured });

describe("workly: nightlySteps", () => {
  it("имя задачи расписания", () => {
    expect(WORKLY_NIGHTLY_JOB).toBe("workly-nightly");
  });

  it("не настроено и ничего не ожидалось — все три флага false", () => {
    for (const flag of [undefined, "", "0", "true"]) {
      expect(nightlySteps({ WORKLY_ATTENDANCE_NIGHTLY: flag }, [conn("LES", false, false)])).toEqual([
        { key: "LES", employees: false, attendance: false, misconfigured: false },
      ]);
    }
  });

  it("не настроено, но есть применённый прогон — misconfigured", () => {
    expect(nightlySteps({}, [conn("LES", true, false)])).toEqual([
      { key: "LES", employees: false, attendance: false, misconfigured: true },
    ]);
  });

  it("не настроено при WORKLY_ATTENDANCE_NIGHTLY=1 — misconfigured, даже без применённого прогона", () => {
    expect(nightlySteps({ WORKLY_ATTENDANCE_NIGHTLY: "1" }, [conn("CHOPAR", false, false)])).toEqual([
      { key: "CHOPAR", employees: false, attendance: false, misconfigured: true },
    ]);
  });

  it("настроено без применённого прогона — сотрудники не сверяются (первый прогон ручной)", () => {
    expect(nightlySteps({}, [conn("LES", false, true)])).toEqual([
      { key: "LES", employees: false, attendance: false, misconfigured: false },
    ]);
  });

  it("настроено и есть применённый прогон — сверка сотрудников", () => {
    expect(nightlySteps({}, [conn("LES", true, true)])).toEqual([
      { key: "LES", employees: true, attendance: false, misconfigured: false },
    ]);
  });

  it("посещаемость только при WORKLY_ATTENDANCE_NIGHTLY=1; значения 0, пустая строка, undefined и true — выключено", () => {
    for (const flag of ["0", "", undefined, "true", "yes", " 1"]) {
      expect(nightlySteps({ WORKLY_ATTENDANCE_NIGHTLY: flag }, [conn("LES", true, true)])[0].attendance).toBe(false);
    }
    expect(nightlySteps({ WORKLY_ATTENDANCE_NIGHTLY: "1" }, [conn("LES", false, true)])).toEqual([
      { key: "LES", employees: false, attendance: true, misconfigured: false },
    ]);
    expect(nightlySteps({ WORKLY_ATTENDANCE_NIGHTLY: "1" }, [conn("LES", true, true)])).toEqual([
      { key: "LES", employees: true, attendance: true, misconfigured: false },
    ]);
  });

  it("подключения обрабатываются независимо и в том же порядке", () => {
    expect(
      nightlySteps({ WORKLY_ATTENDANCE_NIGHTLY: "1" }, [conn("LES", true, true), conn("CHOPAR", true, false)])
    ).toEqual([
      { key: "LES", employees: true, attendance: true, misconfigured: false },
      { key: "CHOPAR", employees: false, attendance: false, misconfigured: true },
    ]);
  });
});

describe("workly: jobFailureCode", () => {
  it("код WorklyError", () => {
    expect(jobFailureCode(new WorklyError("client_invalid", "секрет client_secret=abc"))).toBe("client_invalid");
  });

  it("код KpiError", () => {
    expect(jobFailureCode(new KpiError(409, "run_in_progress"))).toBe("run_in_progress");
  });

  it("любая другая ошибка и не-ошибка — job_failed; текст исключения не возвращается", () => {
    const secret = "Иванов Иван parameters: $1=секрет";
    for (const e of [new Error(secret), new TypeError(secret), { code: "23505", message: secret }, secret, null, undefined, 42]) {
      expect(jobFailureCode(e)).toBe("job_failed");
    }
    expect(jobFailureCode(Object.assign(new Error(secret), { code: "23505" }))).toBe("job_failed");
  });
});

describe("workly: failedJobCode (причина, которую хранит BullMQ)", () => {
  it("snake_case код пропускается, любой другой текст заменяется на job_failed", () => {
    expect(failedJobCode(new Error("client_invalid"))).toBe("client_invalid");
    expect(failedJobCode(new Error("job_failed"))).toBe("job_failed");
    expect(failedJobCode(new Error("job stalled more than allowable limit"))).toBe("job_failed");
    expect(failedJobCode(new Error("Иванов Иван"))).toBe("job_failed");
    expect(failedJobCode(new Error(""))).toBe("job_failed");
    expect(failedJobCode("client_invalid")).toBe("job_failed");
    expect(failedJobCode(undefined)).toBe("job_failed");
  });
});

describe("workly: handleWorklyJob", () => {
  const RUN_ID = "5b1f3c1e-8a40-4f4e-9d54-0a5b8a7d9c11";

  // console.error собираем: текст исключений в логе недопустим.
  async function quietly<T>(f: () => Promise<T>): Promise<{ value?: T; error?: Error; logged: string }> {
    const logged: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "));
    });
    try {
      return { value: await f(), logged: logged.join("\n") };
    } catch (e) {
      return { error: e as Error, logged: logged.join("\n") };
    } finally {
      spy.mockRestore();
    }
  }

  const handlers = (o: { run?: (id: string) => Promise<unknown>; nightly?: () => Promise<unknown> } = {}) => ({
    run: o.run ?? (async () => undefined),
    nightly: o.nightly ?? (async () => []),
  });

  it("workly-run вызывает исполнитель прогона с runId, workly-nightly — ночной прогон", async () => {
    const got: string[] = [];
    await handleWorklyJob(
      { name: WORKLY_RUN_JOB, data: { runId: RUN_ID } },
      handlers({
        run: async (id) => {
          got.push(id);
        },
      })
    );
    expect(got).toEqual([RUN_ID]);

    const result = [{ key: "LES", employees: "applied", attendance: "skipped" }];
    let called = 0;
    const out = await handleWorklyJob(
      { name: WORKLY_NIGHTLY_JOB, data: {} },
      handlers({
        nightly: async () => {
          called++;
          return result;
        },
      })
    );
    expect(called).toBe(1);
    expect(out).toEqual(result);
  });

  it("сбой с текстом: наружу уходит новая Error с одним кодом, лог — имя, runId и код без текста", async () => {
    const secret = "Иванов Иван parameters: 12345 secret";
    const r = await quietly(() =>
      handleWorklyJob(
        { name: WORKLY_RUN_JOB, data: { runId: RUN_ID } },
        handlers({
          run: async () => {
            throw new Error(secret);
          },
        })
      )
    );
    expect(r.error).toBeInstanceOf(Error);
    expect(r.error!.message).toBe("job_failed");
    expect(r.logged).toBe(`workly job failed ${WORKLY_RUN_JOB} ${RUN_ID} job_failed`);
    expect(r.logged).not.toContain("Иванов");
    expect(r.logged).not.toContain("12345");
  });

  it("код WorklyError и KpiError сохраняется; у ночной задачи вместо runId прочерк", async () => {
    const a = await quietly(() =>
      handleWorklyJob(
        { name: WORKLY_RUN_JOB, data: { runId: RUN_ID } },
        handlers({
          run: async () => {
            throw new WorklyError("force_update", "обновите client_id и client_secret=XYZ");
          },
        })
      )
    );
    expect(a.error!.message).toBe("force_update");
    expect(a.error).not.toBeInstanceOf(WorklyError);
    expect(a.logged).toBe(`workly job failed ${WORKLY_RUN_JOB} ${RUN_ID} force_update`);

    const b = await quietly(() =>
      handleWorklyJob(
        { name: WORKLY_NIGHTLY_JOB, data: {} },
        handlers({
          nightly: async () => {
            throw new KpiError(409, "run_in_progress");
          },
        })
      )
    );
    expect(b.error!.message).toBe("run_in_progress");
    expect(b.logged).toBe(`workly job failed ${WORKLY_NIGHTLY_JOB} - run_in_progress`);
  });

  it("неизвестная задача и задача без runId — ошибка с кодом, обработчики не вызываются", async () => {
    let calls = 0;
    const h = handlers({
      run: async () => {
        calls++;
      },
      nightly: async () => {
        calls++;
        return [];
      },
    });
    const a = await quietly(() => handleWorklyJob({ name: "что-то-чужое", data: {} }, h));
    expect(a.error!.message).toBe("unknown_job");
    expect(a.logged).toContain("workly job failed");
    expect(a.logged).toContain("unknown_job");

    const b = await quietly(() => handleWorklyJob({ name: WORKLY_RUN_JOB, data: {} }, h));
    expect(b.error!.message).toBe("bad_job");
    const c = await quietly(() => handleWorklyJob({ name: WORKLY_RUN_JOB, data: { runId: 42 } }, h));
    expect(c.error!.message).toBe("bad_job");
    expect(calls).toBe(0);
  });

  it("worklyJobProcessor: Redis берётся внутри обработчика — сбой Redis уходит только кодом, без текста", async () => {
    const SECRET = "ECONNREFUSED redis://user:pa55@host секрет";
    let asked = 0;
    const redisOf = async () => {
      asked++;
      throw Object.assign(new Error(SECRET), { command: { args: [SECRET] } });
    };
    // База не нужна: до неё обработчик не доходит.
    const process = worklyJobProcessor({} as never, redisOf as never);
    for (const job of [
      { name: WORKLY_RUN_JOB, data: { runId: RUN_ID } },
      { name: WORKLY_NIGHTLY_JOB, data: {} },
    ]) {
      const r = await quietly(() => process(job));
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error!.message).toBe("job_failed");
      expect(r.error!.stack ?? "").not.toContain("секрет");
      expect(r.logged).not.toContain("секрет");
      expect(r.logged).not.toContain("pa55");
      expect(r.logged).toContain("job_failed");
    }
    expect(asked).toBe(2);
    // Чужая задача отклоняется до обращения к Redis.
    const u = await quietly(() => process({ name: "что-то-чужое", data: {} }));
    expect(u.error!.message).toBe("unknown_job");
    expect(asked).toBe(2);
  });

  it("runId не uuid в лог не попадает: прочерк", async () => {
    const r = await quietly(() =>
      handleWorklyJob(
        { name: WORKLY_RUN_JOB, data: { runId: "Иванов Иван" } },
        handlers({
          run: async () => {
            throw new Error("x");
          },
        })
      )
    );
    expect(r.logged).toBe(`workly job failed ${WORKLY_RUN_JOB} - job_failed`);
  });
});
