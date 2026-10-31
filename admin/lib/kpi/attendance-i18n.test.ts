import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";
import { COMMIT_ISSUE_KEY } from "./attendance";
import { RU_LIB } from "./ru";

// Тексты мастера и таблицы загрузок посещаемости: те же ключи во всех четырёх локалях,
// иначе в интерфейсе вместо текста появится имя ключа.
const LOCALES = ["ru", "en", "uz-Latn", "uz-Cyrl"] as const;
const ADMIN = fileURLToPath(new URL("../../", import.meta.url));

function messages(locale: string): any {
  return JSON.parse(readFileSync(join(ADMIN, "messages", `${locale}.json`), "utf8"));
}

function at(obj: any, path: string): unknown {
  return path.split(".").reduce((cur, k) => (cur == null || typeof cur !== "object" ? undefined : cur[k]), obj);
}

/** Все ключи-строки словаря через точку. */
function leafKeys(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : leafKeys(v, `${prefix}${k}.`)));
}

const FAMILIES = ["kpi.lib.attendance", "kpi.lib.errors", "kpiScreens.attendance"] as const;

// Ключи выбора организации в мастере файловой загрузки.
const ORGANIZATION_KEYS = [
  "kpi.lib.errors.organization_required",
  "kpi.lib.errors.bad_organization",
  "kpi.lib.attendance.issue.organizationRequired",
  "kpi.lib.attendance.replace",
  "kpiScreens.attendance.result.organization",
  "kpiScreens.attendance.imports.colOrganization",
  "kpiScreens.attendance.imports.colSource",
  "kpiScreens.attendance.imports.sourceFile",
  "kpiScreens.attendance.imports.sourceApi",
  "kpiScreens.attendance.wizard.organization",
  "kpiScreens.attendance.wizard.organizationPlaceholder",
  "kpiScreens.attendance.wizard.organizationsEmpty",
];

describe("ru.ts совпадает с messages/ru.json (kpi.lib)", () => {
  it("русский запасной словарь не расходится со словарём локали", () => {
    expect(RU_LIB).toEqual(messages("ru").kpi.lib);
  });
});

for (const locale of LOCALES) {
  describe(`загрузка посещаемости: организация (${locale})`, () => {
    const m = messages(locale);

    it("ключи выбора организации — непустые строки", () => {
      const empty = ORGANIZATION_KEYS.filter((k) => {
        const v = at(m, k);
        return typeof v !== "string" || v.trim() === "";
      });
      expect(empty).toEqual([]);
    });

    it("подсказка по коду проверки commit лежит под ключом из COMMIT_ISSUE_KEY", () => {
      expect(typeof at(m, `kpi.${COMMIT_ISSUE_KEY.organization_required}`)).toBe("string");
    });

    it("набор ключей совпадает с русским", () => {
      for (const family of FAMILIES) {
        const ru = new Set(leafKeys(at(messages("ru"), family)));
        const own = new Set(leafKeys(at(m, family)));
        expect({ family, missing: [...ru].filter((k) => !own.has(k)) }).toEqual({ family, missing: [] });
        expect({ family, extra: [...own].filter((k) => !ru.has(k)) }).toEqual({ family, extra: [] });
      }
    });

    it("текст замены импорта подставляет организацию, месяц, файл, дату и число строк", () => {
      const errors: string[] = [];
      const tr = createTranslator({ locale, messages: m, namespace: "kpi", onError: (e: Error) => errors.push(e.message) } as never) as unknown as (
        key: string,
        values: Record<string, string | number>
      ) => string;
      const text = tr("lib.attendance.replace", { org: "ORG_X", month: "MONTH_X", file: "FILE_X", date: "DATE_X", matched: 4242 });
      for (const part of ["ORG_X", "MONTH_X", "FILE_X", "DATE_X", "4242"]) expect(text).toContain(part);
      expect(errors).toEqual([]);
    });
  });
}
