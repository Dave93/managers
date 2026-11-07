import { expect, it } from "bun:test";
import type { EvDayOffForm } from "@backend/modules/kpi/tg-app/ev-types";
import { DICT } from "../src/i18n";
import { type DayOffDraft, dayOffBody, dayOffCount, dayOffFormView, dayOffIssues, dayOffWarnings, overLimitMonths } from "../src/view/ev-dayoff";

const F = (o: Partial<EvDayOffForm> = {}): EvDayOffForm => ({
  employee: { id: "e1", first_name: "Ботир", last_name: "Алиев", terminal_name: "Филиал А" },
  reasons: ["sick", "family", "time_off", "vacation", "schedule", "other"],
  window: { min: "2025-10-01", max: "2025-11-26" },
  max_range_days: 31,
  month_limit: 4,
  existing: [],
  submitted_months: [],
  ...o,
});
const D = (o: Partial<DayOffDraft> = {}): DayOffDraft => ({ from: "2025-10-27", to: "2025-10-29", reason: "sick", text: "", ...o });
const msg = (key: keyof typeof DICT.ru, vars: Record<string, string> = {}) => DICT.ru[key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

it("dayOffCount: дни включительно, неверные и обратные даты — 0, через границу месяца", () => {
  expect(dayOffCount(D())).toBe(3);
  expect(dayOffCount(D({ from: "2025-10-27", to: "2025-10-27" }))).toBe(1);
  expect(dayOffCount(D({ from: "2025-10-30", to: "2025-11-02" }))).toBe(4);
  expect(dayOffCount(D({ from: "2025-10-29", to: "2025-10-27" }))).toBe(0);
  expect(dayOffCount(D({ from: "", to: "2025-10-27" }))).toBe(0);
  expect(dayOffCount(D({ from: "2025-02-30", to: "2025-03-01" }))).toBe(0);
});

it("dayOffIssues: годная заявка без замечаний", () => {
  expect(dayOffIssues(D(), F(), "ru")).toEqual([]);
  expect(dayOffIssues(D({ reason: "other", text: "  Свадьба брата " }), F(), "ru")).toEqual([]);
});

it("dayOffIssues: даты, длина, окно, причина, текст «другой»", () => {
  expect(dayOffIssues(D({ to: "2025-10-26" }), F(), "ru")).toEqual([msg("ev_dayoff_err_dates")]);
  expect(dayOffIssues(D({ from: "", to: "" }), F(), "ru")).toEqual([msg("ev_dayoff_err_dates")]);
  expect(dayOffIssues(D({ from: "2025-10-01", to: "2025-11-05" }), F(), "ru")).toEqual([msg("ev_dayoff_err_long", { n: "31" })]);
  expect(dayOffIssues(D({ from: "2025-09-30", to: "2025-10-01" }), F(), "ru")).toEqual([msg("ev_dayoff_err_window", { from: "1 октября", to: "26 ноября" })]);
  expect(dayOffIssues(D({ from: "2025-11-26", to: "2025-11-27" }), F(), "ru")).toHaveLength(1);
  expect(dayOffIssues(D({ reason: null }), F(), "ru")).toEqual([msg("ev_dayoff_err_reason")]);
  expect(dayOffIssues(D({ reason: "other", text: "ab" }), F(), "ru")).toEqual([msg("ev_dayoff_err_text", { min: "3" })]);
  expect(dayOffIssues(D({ reason: "other", text: " -- " }), F(), "ru")).toEqual([msg("ev_dayoff_err_text", { min: "3" })]);
  // Несколько замечаний сразу, по порядку: даты, причина.
  expect(dayOffIssues(D({ to: "2025-10-26", reason: null }), F(), "ru")).toHaveLength(2);
});

it("dayOffBody: текст только у «другой», пробелы срезаются", () => {
  expect(dayOffBody("e1", D({ reason: "sick", text: "игнор" }) as DayOffDraft & { reason: "sick" })).toEqual({ employee_id: "e1", from: "2025-10-27", to: "2025-10-29", reason_code: "sick" });
  expect(dayOffBody("e1", D({ reason: "other", text: "  Свадьба брата " }) as DayOffDraft & { reason: "other" })).toEqual({
    employee_id: "e1", from: "2025-10-27", to: "2025-10-29", reason_code: "other", reason_text: "Свадьба брата",
  });
});

it("dayOffFormView: заголовок, подписи причин на двух языках, окно, уже выданные дни", () => {
  const vm = dayOffFormView(F({ existing: ["2025-10-30", "2025-10-31"] }), "ru");
  expect(vm.title).toBe("Выходной · Алиев Ботир");
  expect(vm.name).toBe("Алиев Ботир");
  expect(vm.reasons.map((r) => r.label)).toEqual(["Болезнь", "Семейные обстоятельства", "Отгул", "Отпуск", "По графику", "Другая причина"]);
  expect(vm.reasons.map((r) => r.code)).toEqual(["sick", "family", "time_off", "vacation", "schedule", "other"]);
  expect([vm.min, vm.max]).toEqual(["2025-10-01", "2025-11-26"]);
  expect(vm.existing).toBe("Уже выдано: 30 октября, 31 октября");
  expect(dayOffFormView(F(), "ru").existing).toBe("");
  expect(dayOffFormView(F(), "uz").reasons.map((r) => r.label)).toEqual(["Kasallik", "Oilaviy sharoitlar", "Otgul", "Taʼtil", "Jadval boʻyicha", "Boshqa sabab"]);
});

it("dayOffWarnings: предупреждает о месяцах, где оценка уже отправлена, и только о них", () => {
  const f = F({ submitted_months: ["2025-10-01"] });
  expect(dayOffWarnings(D(), f, "ru")).toEqual([DICT.ru.ev_dayoff_warn_submitted.replace("{months}", "октябрь")]);
  // Диапазон через границу: отправлен только октябрь — упоминается один он.
  expect(dayOffWarnings(D({ from: "2025-10-30", to: "2025-11-02" }), f, "ru")).toEqual([DICT.ru.ev_dayoff_warn_submitted.replace("{months}", "октябрь")]);
  expect(dayOffWarnings(D({ from: "2025-11-03", to: "2025-11-04" }), f, "ru")).toEqual([]);
  expect(dayOffWarnings(D(), F(), "ru")).toEqual([]);
  // Оба месяца диапазона отправлены.
  expect(dayOffWarnings(D({ from: "2025-10-30", to: "2025-11-02" }), F({ submitted_months: ["2025-10-01", "2025-11-01"] }), "ru")[0]).toContain("октябрь и ноябрь");
  // Неверные даты предупреждений не дают: о них скажут замечания.
  expect(dayOffWarnings(D({ from: "", to: "" }), f, "ru")).toEqual([]);
  expect(dayOffWarnings(D(), f, "uz")[0]).toContain("Oktabr");
});

it("overLimitMonths: лимит 4 в месяц мягкий, считает уже выданные любым автором и только новые дни диапазона", () => {
  const f = F({ existing: ["2025-10-01", "2025-10-02", "2025-10-03"] });
  // 3 уже есть + 1 новый = 4: это ещё не больше лимита
  expect(overLimitMonths(D({ from: "2025-10-27", to: "2025-10-27" }), f)).toEqual([]);
  // +2 новых = 5 > 4
  expect(overLimitMonths(D({ from: "2025-10-27", to: "2025-10-28" }), f)).toEqual([{ period: "2025-10-01", total: 5 }]);
  // уже выданный день заново не считается: 3 + 1 новый (4-го числа нет, 3-е есть) = 4
  expect(overLimitMonths(D({ from: "2025-10-03", to: "2025-10-04" }), f)).toEqual([]);
  // диапазон без новых дней не предупреждает, даже если месяц и так сверх лимита
  const over = F({ existing: ["2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04", "2025-10-05"] });
  expect(overLimitMonths(D({ from: "2025-10-05", to: "2025-10-05" }), over)).toEqual([]);
  // через границу месяца: октябрь в лимите, ноябрь нет
  const nov = F({ existing: ["2025-11-10", "2025-11-11", "2025-11-12", "2025-11-13"] });
  expect(overLimitMonths(D({ from: "2025-10-31", to: "2025-11-01" }), nov)).toEqual([{ period: "2025-11-01", total: 5 }]);
  // неверные даты — пусто
  expect(overLimitMonths(D({ from: "", to: "" }), f)).toEqual([]);
});

it("dayOffWarnings: больше лимита в месяце — предупреждение «в октябре … 5, лимит 4», выдача не запрещена", () => {
  const f = F({ existing: ["2025-10-01", "2025-10-02", "2025-10-03"] });
  const w = dayOffWarnings(D({ from: "2025-10-27", to: "2025-10-28" }), f, "ru");
  expect(w).toEqual([DICT.ru.ev_dayoff_warn_limit.replace("{month}", "октябре").replace("{n}", "5").replace("{limit}", "4")]);
  // это предупреждение, а не замечание: проверка заявки его не возвращает
  expect(dayOffIssues(D({ from: "2025-10-27", to: "2025-10-28" }), f, "ru")).toEqual([]);
  // в лимите — тишина; оба предупреждения вместе, если оценка отправлена
  expect(dayOffWarnings(D({ from: "2025-10-27", to: "2025-10-27" }), f, "ru")).toEqual([]);
  expect(dayOffWarnings(D({ from: "2025-10-27", to: "2025-10-28" }), F({ ...f, submitted_months: ["2025-10-01"] }), "ru")).toHaveLength(2);
  expect(dayOffWarnings(D({ from: "2025-10-27", to: "2025-10-28" }), f, "uz")[0]).toContain("Oktabr oyida");
});
