import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";
import { PLAN_GROUP_ORDER, WORKLY_BLOCK_REASONS, WORKLY_ERROR_CODES } from "./workly";
import { ATTENDANCE_ERROR_CODES, CHANGE_TYPES, RUN_STATUSES, attendanceErrorKey, attendanceResultLines } from "./workly-view";

// Тексты экрана «Синхронизация Workly» (kpiScreens.workly.*) по локалям. Сейчас проверяется
// только ru: остальные локали добавит задача 6 (список LOCALES ниже).
const LOCALES = ["ru"] as const;

const ADMIN = fileURLToPath(new URL("../../", import.meta.url));

// Файлы экрана, где ключи берутся через t = useTranslations("kpiScreens.workly").
const SCREEN_FILES = [
  "app/[locale]/kpi/workly/page.tsx",
  "app/[locale]/kpi/workly/_components/connection-card.tsx",
  "app/[locale]/kpi/workly/_components/plan-review.tsx",
  "app/[locale]/kpi/workly/_components/manual-link-dialog.tsx",
  "app/[locale]/kpi/workly/_components/organization-select.tsx",
  "app/[locale]/kpi/workly/_components/locations-table.tsx",
  "app/[locale]/kpi/workly/_components/attendance-sync.tsx",
  "app/[locale]/kpi/workly/_components/quality-report.tsx",
];

function screen(locale: string): Record<string, unknown> {
  const all = JSON.parse(readFileSync(join(ADMIN, "messages", `${locale}.json`), "utf8"));
  return all?.kpiScreens?.workly ?? {};
}

function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Все ключи-строки словаря через точку. */
function leafKeys(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? [prefix + k] : leafKeys(v, `${prefix}${k}.`)
  );
}

/** Ключи, которых нет или которые не непустая строка. */
function missing(obj: unknown, keys: readonly string[]): string[] {
  return keys.filter((k) => {
    const v = at(obj, k);
    return typeof v !== "string" || v.trim() === "";
  });
}

/** Литеральные ключи t("…") из файлов экрана (шаблонные ключи проверяются семействами ниже). */
function literalKeys(): string[] {
  const keys = new Set<string>();
  for (const rel of SCREEN_FILES) {
    const src = readFileSync(join(ADMIN, rel), "utf8");
    for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(m[1]!);
  }
  return [...keys].sort();
}

const RUN_KINDS = ["employees", "attendance"] as const;
const TRIGGERS = ["manual", "schedule"] as const;
const SKIP_REASONS = ["excluded", "stale", "conflict"] as const;

for (const locale of LOCALES) {
  describe(`kpiScreens.workly (${locale})`, () => {
    const t = screen(locale);

    it("заголовок и описание экрана", () => {
      expect(missing(t, ["title", "description"])).toEqual([]);
    });

    it("семейства connections, card, plan, report, confirm, link, locations, attendance, quality не пустые", () => {
      for (const family of ["connections", "card", "plan", "report", "confirm", "link", "locations", "attendance", "quality"]) {
        const v = t[family];
        expect(v && typeof v === "object" ? Object.keys(v).length : 0).toBeGreaterThan(0);
      }
    });

    it("название каждого вида пункта плана", () => {
      expect(missing(t, PLAN_GROUP_ORDER.map((k) => `kinds.${k}`))).toEqual([]);
    });

    it("причины пропуска при применении", () => {
      expect(missing(t, SKIP_REASONS.map((r) => `skipReasons.${r}`))).toEqual([]);
    });

    it("причина блокировки ночного прогона, включая unknown", () => {
      expect(missing(t, [...WORKLY_BLOCK_REASONS, "unknown"].map((r) => `blocked.${r}`))).toEqual([]);
    });

    it("текст каждого кода ошибки Workly, включая unknown", () => {
      expect(WORKLY_ERROR_CODES.length).toBeGreaterThanOrEqual(29);
      expect(missing(t, [...WORKLY_ERROR_CODES, "unknown"].map((c) => `errors.${c}`))).toEqual([]);
    });

    it("статус, вид и источник прогона в карточке", () => {
      const keys = [
        ...RUN_STATUSES.map((s) => `card.status.${s}`),
        ...RUN_KINDS.map((k) => `card.kind.${k}`),
        ...TRIGGERS.map((k) => `card.trigger.${k}`),
      ];
      expect(missing(t, keys)).toEqual([]);
    });

    it("описание каждого вида изменения в строке плана", () => {
      expect(missing(t, CHANGE_TYPES.map((c) => `plan.change.${c}`))).toEqual([]);
    });

    it("итог синхронизации посещаемости: подпись с {count} и пояснение у каждой строки", () => {
      const lines = attendanceResultLines({});
      expect(lines.map((l) => l.key)).toEqual(["days", "unknown", "carried"]);
      expect(missing(t, lines.flatMap((l) => [l.label, l.hint]))).toEqual([]);
      for (const l of lines) expect(at(t, l.label)).toContain("{count}");
    });

    it("свой текст ошибки блока посещаемости для каждого кода из ATTENDANCE_ERROR_CODES", () => {
      expect(ATTENDANCE_ERROR_CODES.length).toBe(4);
      expect(missing(t, ATTENDANCE_ERROR_CODES.map((c) => attendanceErrorKey(c) ?? `attendance.errors.${c}`))).toEqual([]);
      // Свой текст отличается от общего: иначе переопределение не нужно.
      for (const c of ATTENDANCE_ERROR_CODES) {
        if (at(t, `errors.${c}`) !== undefined) expect(at(t, `attendance.errors.${c}`)).not.toBe(at(t, `errors.${c}`));
      }
    });

    it("каждая строка — корректное сообщение ICU и форматируется со своими параметрами", () => {
      const errors: string[] = [];
      const tr = createTranslator({
        locale,
        messages: { w: t } as never,
        namespace: "w",
        onError: (e: Error) => errors.push(e.message),
      } as never) as unknown as (key: string, values?: Record<string, string>) => string;
      for (const key of leafKeys(t)) {
        const src = at(t, key) as string;
        const values = Object.fromEntries([...src.matchAll(/\{(\w+)\}/g)].map((m) => [m[1]!, "1"]));
        const out = tr(key, values);
        if (out.includes("{")) errors.push(`${key}: не подставлен параметр`);
      }
      expect(errors).toEqual([]);
    });

    it("каждый литеральный ключ t(\"…\") из файлов экрана есть в словаре", () => {
      for (const rel of SCREEN_FILES) expect(existsSync(join(ADMIN, rel))).toBe(true);
      const keys = literalKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(missing(t, keys)).toEqual([]);
    });
  });
}
