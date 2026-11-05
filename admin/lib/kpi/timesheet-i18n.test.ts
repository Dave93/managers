import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";

// Тексты статуса «Выходной» в табеле: те же ключи во всех четырёх локалях, иначе в интерфейсе вместо текста
// появится имя ключа. Узбекские тексты (латиница и кириллица) ждут проверки носителем.
const LOCALES = ["ru", "en", "uz-Latn", "uz-Cyrl"] as const;
const ADMIN = fileURLToPath(new URL("../../", import.meta.url));
const messages = (locale: string): any => JSON.parse(readFileSync(join(ADMIN, "messages", `${locale}.json`), "utf8"));
const at = (obj: any, path: string): unknown => path.split(".").reduce((cur, k) => (cur == null || typeof cur !== "object" ? undefined : cur[k]), obj);

const KEYS = [
  "tip.dayoff",
  "legend.dayoff",
  "sheet.summary.dayoff",
  "sheet.dayoff",
  "sheet.dayoffBy",
  "reason.sick",
  "reason.family",
  "reason.time_off",
  "reason.vacation",
  "reason.schedule",
  "reason.other",
] as const;

describe("табель: тексты выходного в четырёх локалях", () => {
  for (const locale of LOCALES) {
    it(`${locale}: все ключи есть и не пусты`, () => {
      const ts = messages(locale).kpiScreens.timesheet;
      for (const k of KEYS) expect(typeof at(ts, k) === "string" && (at(ts, k) as string).trim() !== "", `${locale}: ${k}`).toBe(true);
    });
    it(`${locale}: «выдал» принимает имя`, () => {
      const t = createTranslator({ locale, messages: messages(locale), namespace: "kpiScreens.timesheet" });
      expect(t("sheet.dayoffBy", { name: "Айбек" })).toContain("Айбек");
    });
  }
  it("кириллический узбекский без латиницы, русский текст подписей причин", () => {
    const cyr = messages("uz-Cyrl").kpiScreens.timesheet;
    for (const k of KEYS) expect((at(cyr, k) as string).replace(/\{\w+\}/g, "")).not.toMatch(/[A-Za-z]/);
    const ru = messages("ru").kpiScreens.timesheet;
    expect(["sick", "family", "time_off", "vacation", "schedule", "other"].map((c) => at(ru, `reason.${c}`))).toEqual([
      "Болезнь", "Семейные обстоятельства", "Отгул", "Отпуск", "По графику", "Другая причина",
    ]);
  });
});
