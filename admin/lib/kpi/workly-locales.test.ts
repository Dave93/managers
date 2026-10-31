import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPE, parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

// Паритет переводов экрана «Синхронизация Workly» (kpiScreens.workly.*): ru.json — источник,
// en, uz-Latn и uz-Cyrl обязаны повторять его ключи, параметры ICU и не содержать
// непереведённых строк. Парсер тот же, что запускает next-intl (use-intl → intl-messageformat).
const SOURCE = "ru";
const TRANSLATIONS = ["en", "uz-Latn", "uz-Cyrl"] as const;
const PREFIX = "kpiScreens.workly.";

const ADMIN = fileURLToPath(new URL("../../", import.meta.url));

/** Латиница, которая остаётся латиницей и в кириллическом узбекском (идентификаторы и форматы). */
const TECH_TOKENS = ["workly", "kpi", "id", "xlsx", "xls", "csv", "api", "iiko"];

/**
 * Ключи, где кириллический узбекский законно совпадает с русским (заимствованные слова:
 * «филиал», «терминал», «локация»). Любой другой ключ с русским текстом как есть — недоперевод.
 */
const SAME_AS_RU_OK = new Set([
  "kpiScreens.workly.plan.change.terminal",
  "kpiScreens.workly.link.location",
  "kpiScreens.workly.locations.colTerminal",
  "kpiScreens.workly.quality.colBranch",
]);

/** Плоский словарь «ключ через точку → значение» для kpiScreens.workly.* из <locale>.json. */
function worklyMessages(locale: string): Map<string, unknown> {
  const all = JSON.parse(readFileSync(join(ADMIN, "messages", `${locale}.json`), "utf8"));
  const out = new Map<string, unknown>();
  const walk = (node: unknown, path: string) => {
    if (node != null && typeof node === "object" && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}${k}.`);
    } else {
      out.set(path.slice(0, -1), node);
    }
  };
  walk(all?.kpiScreens?.workly ?? {}, PREFIX);
  return out;
}

function parseIcu(message: string, locale: string): MessageFormatElement[] {
  return parse(message, { requiresOtherClause: true, locale: new Intl.Locale(locale) });
}

/** Имена параметров ICU (аргументы, plural, select, number/date/time, теги) во всех ветках. */
function argNames(elements: MessageFormatElement[], into = new Set<string>()): Set<string> {
  for (const el of elements) {
    switch (el.type) {
      case TYPE.literal:
      case TYPE.pound:
        break;
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        into.add(el.value);
        break;
      case TYPE.select:
      case TYPE.plural:
        into.add(el.value);
        for (const opt of Object.values(el.options)) argNames(opt.value, into);
        break;
      case TYPE.tag:
        into.add(`<${el.value}>`);
        argNames(el.children, into);
        break;
    }
  }
  return into;
}

/** Все plural-элементы сообщения, в том числе вложенные в ветки и теги. */
function pluralsOf(elements: MessageFormatElement[]): Extract<MessageFormatElement, { type: TYPE.plural }>[] {
  const out: Extract<MessageFormatElement, { type: TYPE.plural }>[] = [];
  for (const el of elements) {
    if (el.type === TYPE.plural) out.push(el);
    if (el.type === TYPE.select || el.type === TYPE.plural) for (const opt of Object.values(el.options)) out.push(...pluralsOf(opt.value));
    if (el.type === TYPE.tag) out.push(...pluralsOf(el.children));
  }
  return out;
}

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN_WORD = /[A-Za-z][A-Za-z0-9_]*/g;

/** Видимый текст сообщения: только литералы всех веток, без имён параметров и ICU-синтаксиса. */
function literals(elements: MessageFormatElement[]): string[] {
  return elements.flatMap((el) => {
    if (el.type === TYPE.literal) return [el.value];
    if (el.type === TYPE.select || el.type === TYPE.plural) return Object.values(el.options).flatMap((opt) => literals(opt.value));
    if (el.type === TYPE.tag) return literals(el.children);
    return [];
  });
}

function textOf(message: string, locale: string): string {
  try {
    return literals(parseIcu(message, locale)).join(" ");
  } catch {
    return ""; // нераспознанный ICU ловит отдельный тест
  }
}

const sorted = (s: Iterable<string>) => [...s].sort();

const source = worklyMessages(SOURCE);
const sourceKeys = sorted(source.keys());

describe("kpiScreens.workly (ru): источник переводов", () => {
  it("ключей достаточно, все значения — непустые строки с корректным ICU", () => {
    expect(sourceKeys.length).toBeGreaterThanOrEqual(200); // защита от пустого источника: иначе все проверки ниже тривиально зелёные
    for (const [key, value] of source) {
      expect({ key, ok: typeof value === "string" && value.trim() !== "" }).toEqual({ key, ok: true });
      expect(() => parseIcu(value as string, SOURCE), key).not.toThrow();
    }
  });
});

for (const locale of TRANSLATIONS) {
  describe(`kpiScreens.workly (${locale}): паритет с ru`, () => {
    const own = worklyMessages(locale);

    it("каждый ключ ru есть в переводе", () => {
      expect(sourceKeys.filter((k) => !own.has(k))).toEqual([]);
    });

    it("в переводе нет лишних ключей", () => {
      expect(sorted(own.keys()).filter((k) => !source.has(k))).toEqual([]);
    });

    it("значения: непустые строки, не равные своему ключу (так next-intl показывает отсутствующий текст)", () => {
      const bad: string[] = [];
      for (const [key, value] of own) {
        if (typeof value !== "string" || value.trim() === "") bad.push(`${key}: не строка или пусто`);
        else if (value === key || value === key.slice(PREFIX.length)) bad.push(`${key}: равно ключу`);
        else if (value === source.get(key) && CYRILLIC.test(value) && !SAME_AS_RU_OK.has(key)) bad.push(`${key}: русский текст скопирован как есть`);
      }
      expect(bad).toEqual([]);
    });

    it("набор параметров ICU каждого сообщения совпадает с русским", () => {
      const bad: string[] = [];
      for (const key of sourceKeys) {
        const value = own.get(key);
        if (typeof value !== "string") continue;
        let names: string[];
        try {
          names = sorted(argNames(parseIcu(value, locale)));
        } catch {
          continue; // нераспознанный ICU ловит следующий тест
        }
        const expected = sorted(argNames(parseIcu(source.get(key) as string, SOURCE)));
        if (names.join(",") !== expected.join(",")) bad.push(`${key}: ${JSON.stringify(names)} вместо ${JSON.stringify(expected)}`);
      }
      expect(bad).toEqual([]);
    });

    it("каждое сообщение — корректный ICU для локали; plural с веткой other и допустимыми категориями", () => {
      const bad: string[] = [];
      for (const [key, value] of own) {
        if (typeof value !== "string") continue;
        let ast: MessageFormatElement[];
        try {
          ast = parseIcu(value, locale);
        } catch (e) {
          bad.push(`${key}: ${(e as Error).message}`);
          continue;
        }
        for (const plural of pluralsOf(ast)) {
          const allowed = new Set<string>(new Intl.PluralRules(locale, { type: plural.pluralType }).resolvedOptions().pluralCategories);
          const wrong = Object.keys(plural.options).filter((c) => !c.startsWith("=") && !allowed.has(c));
          if (wrong.length > 0) bad.push(`${key}: категории ${wrong.join(", ")} недопустимы для ${locale}`);
          if (!("other" in plural.options)) bad.push(`${key}: у plural нет ветки other`);
        }
      }
      expect(bad).toEqual([]);
    });

    it("латинские технические токены русского текста (Workly, client_id, HR…) сохранены без изменений", () => {
      const bad: string[] = [];
      for (const key of sourceKeys) {
        const translated = own.get(key);
        if (typeof translated !== "string") continue;
        const have = new Set(textOf(translated, locale).match(LATIN_WORD) ?? []);
        const lost = [...new Set(textOf(source.get(key) as string, SOURCE).match(LATIN_WORD) ?? [])].filter((w) => !have.has(w));
        if (lost.length > 0) bad.push(`${key}: потеряно ${lost.join(", ")}`);
      }
      expect(bad).toEqual([]);
    });

    it("кнопки и разделы, названные в «кавычках», называются так же, как в самом интерфейсе", () => {
      // «Проверить» в русском тексте — это значение ключа card.check; перевод подсказки обязан
      // содержать перевод того же ключа, иначе подсказка отсылает к несуществующей кнопке.
      const bad: string[] = [];
      for (const key of sourceKeys) {
        const ru = source.get(key) as string;
        const translated = own.get(key);
        if (typeof translated !== "string") continue;
        for (const [, quoted] of ru.matchAll(/«([^»]+)»/g)) {
          const targets = sourceKeys.filter((k) => source.get(k) === quoted && k !== key);
          if (targets.length === 0) continue;
          const names = targets.map((k) => own.get(k)).filter((v): v is string => typeof v === "string");
          if (!names.some((name) => translated.includes(name))) bad.push(`${key}: нет «${names.join("» или «")}»`);
        }
      }
      expect(bad).toEqual([]);
    });

    if (locale === "uz-Cyrl") {
      it("кириллический узбекский: нет чисто латинских строк длиннее 3 слов", () => {
        const bad: string[] = [];
        for (const [key, value] of own) {
          if (typeof value !== "string" || CYRILLIC.test(value)) continue;
          const words = textOf(value, locale)
            .split(/\s+/)
            .filter((w) => /\p{L}/u.test(w));
          if (words.length > 3) bad.push(`${key}: ${value}`);
        }
        expect(bad).toEqual([]);
      });

      it("кириллический узбекский: латинские слова только из русского оригинала и списка технических токенов", () => {
        const bad: string[] = [];
        for (const [key, value] of own) {
          if (typeof value !== "string") continue;
          const allowed = new Set(TECH_TOKENS);
          for (const w of textOf((source.get(key) as string) ?? "", SOURCE).match(LATIN_WORD) ?? []) allowed.add(w.toLowerCase());
          const stray = (textOf(value, locale).match(LATIN_WORD) ?? []).filter((w) => !allowed.has(w.toLowerCase()));
          if (stray.length > 0) bad.push(`${key}: ${stray.join(", ")}`);
        }
        expect(bad).toEqual([]);
      });
    } else {
      it("нет кириллицы: русский текст не остался непереведённым", () => {
        const bad = [...own].filter(([, value]) => typeof value === "string" && CYRILLIC.test(value)).map(([key, value]) => `${key}: ${value}`);
        expect(bad).toEqual([]);
      });
    }
  });
}
