import { afterEach, expect, it } from "bun:test";
import { DICT, STATUS_TEXT, lang, monthName, monthsList, quarterTitle, ruPlural, setLang, t } from "../src/i18n";

afterEach(() => setLang("ru"));

it("месяцы: падежи и списки", () => {
  expect(monthName("2026-10-01", "gen", "ru")).toBe("октября");
  expect(monthName("2026-10-01", "prep", "ru")).toBe("октябре");
  expect(monthName("2026-10-01", "nom", "ru")).toBe("октябрь");
  expect(monthName("2026-10-01", "gen", "uz")).toBe("oktabr");
  expect(monthsList(["2026-11-01", "2026-12-01"], "nom", "ru")).toBe("ноябрь и декабрь");
  expect(monthsList(["2026-11-01", "2026-12-01"], "nom", "uz")).toBe("noyabr va dekabr");
  expect(monthsList(["2026-12-01"], "prep", "ru")).toBe("декабре");
});
it("квартал: римская цифра, с годом", () => {
  expect(quarterTitle("2026-10-01", "ru")).toBe("IV квартал");
  expect(quarterTitle("2026-10-01", "uz", true)).toBe("2026-yil IV chorak");
  expect(quarterTitle("2026-10-01", "ru", true)).toBe("IV квартал 2026");
  expect(quarterTitle("2026-01-01", "uz")).toBe("I chorak");
  expect(quarterTitle("2026-08-01", "ru")).toBe("III квартал");
});
it("ruPlural", () => {
  const f: [string, string, string] = ["сотрудника", "сотрудников", "сотрудников"];
  expect([1, 2, 5, 11, 21].map((n) => ruPlural(n, f))).toEqual(["сотрудника", "сотрудников", "сотрудников", "сотрудников", "сотрудника"]);
  const m: [string, string, string] = ["один", "два", "много"];
  expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111].map((n) => ruPlural(n, m)))
    .toEqual(["один", "два", "два", "много", "много", "много", "много", "один", "два", "много", "много"]);
});
it("словари: одинаковые ключи, узбекский без ASCII-апострофа", () => {
  expect(Object.keys(DICT.ru).sort()).toEqual(Object.keys(DICT.uz).sort());
  for (const v of Object.values(DICT.uz)) expect(v).not.toMatch(/['`’]/);
  for (const v of Object.values(STATUS_TEXT)) expect(v.uz).not.toMatch(/['`’]/);
  for (const v of Object.values(DICT.ru)) expect(v.length).toBeGreaterThan(0);
  for (const v of Object.values(DICT.uz)) expect(v.length).toBeGreaterThan(0);
  expect(Object.keys(STATUS_TEXT).sort()).toEqual(["expired", "inactive", "not_bound", "not_configured", "offline", "outside", "sdk_failed", "unknown"]);
});
it("узбекский: oʻ/gʻ с U+02BB, eʼ/maʼ с U+02BC", () => {
  expect(DICT.uz.dsp_window_closed).toBe("E\u02bctiroz muddati o\u02bbtdi.");
  expect(DICT.uz.src_attendance).toBe("Workly ma\u02bclumotlari bo\u02bbyicha");
});
it("пробел U+00A0 перед сум, soʻm и % в шаблонах", () => {
  expect(DICT.ru.h_now).toContain("{sum}\u00a0сум");
  expect(DICT.uz.h_now).toContain("{sum}\u00a0soʻm");
  expect(DICT.ru.h_keep).toContain("{pct}\u00a0%");
  expect(DICT.uz.h_next).toContain("{pct}\u00a0%");
  expect(DICT.ru.badge_approved).toContain("{sum}\u00a0сум");
});
it("t: подстановки и заглавная буква только у шаблона с «{» в начале", () => {
  setLang("uz");
  expect(lang()).toBe("uz");
  expect(t("pending_viol", { month: "noyabr", n: 2 })).toBe("Noyabrdagi qoidabuzarliklar: 2");
  setLang("ru");
  expect(t("pending_title", { month: "ноябрь" })).toBe("Ноябрь ещё не оценён");
  expect(t("badge_prelim")).toBe("предварительно");
  expect(t("hist_running")).toBe("идёт");
  expect(t("eval_pending", { n: 3, employees: "сотрудников", date: "7 декабря" })).toBe("Нужно оценить 3 сотрудников до 7 декабря");
});
