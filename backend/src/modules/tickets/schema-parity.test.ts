import { describe, expect, it } from "bun:test";

import { validateSchema } from "./fields";
import {
  toDrafts,
  toSchema,
  validateDrafts,
} from "../../../../admin/app/[locale]/tickets/types/_components/rules";

// Редактор типов в админке проверяет схему сам, до отправки, и по замыслу
// должен говорить то же, что скажет сервер. Это не пожелание, а проверяемый
// факт: здесь один и тот же набор схем прогоняется через настоящий
// validateSchema и через правила редактора (admin/.../types/_components/
// rules.ts, чистый модуль без React), и результаты сверяются.
//
// Сервер останавливается на первой ошибке поля, клиент собирает все (так
// человек видит их разом), но первая ошибка поля у клиента — та, что назвал бы
// сервер. Поэтому сверяется последовательность «по одной ошибке на сломанное
// поле» в порядке полей, строка в строку: `${where}: ${clause}`.
//
// Не сверяется то, что редактор породить не может: схема не массив, элемент
// не объект, ключ не строка, тип не select/text. В черновике тип — переключатель
// из двух значений, остальное — строки в полях ввода.

type Raw = unknown[];

const firstPerField = (raw: Raw) => {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const i of validateDrafts(toDrafts(raw))) {
    if (seen.has(i.fieldIndex)) continue;
    seen.add(i.fieldIndex);
    out.push(`${i.where}: ${i.clause}`);
  }
  return out;
};

const serverErrors = (raw: Raw) => {
  const r = validateSchema(raw);
  return r.ok ? [] : r.errors;
};

const opt = (value: string, label_ru = "Р", label_uz = "У") => ({ value, label_ru, label_uz });
const f = (over: Record<string, unknown> = {}) => ({
  key: "k",
  type: "text",
  required: false,
  label_ru: "Р",
  label_uz: "У",
  ...over,
});
const sel = (over: Record<string, unknown> = {}) => f({ type: "select", options: [opt("a")], ...over });

const CASES: [string, Raw][] = [
  ["пустая схема", []],
  ["одно text-поле", [f()]],
  ["три поля из сида (камеры)", [
    sel({ key: "broken_part", required: true, options: [opt("camera"), opt("dvr"), opt("no_record")] }),
    sel({ key: "zone", options: [opt("cashier"), opt("hall")] }),
    f({ key: "note" }),
  ]],
  ["ключ пустой", [f({ key: "" })]],
  ["ключ с заглавной", [f({ key: "Abc" })]],
  ["ключ с цифры", [f({ key: "1abc" })]],
  ["ключ с дефисом", [f({ key: "a-b" })]],
  ["ключ с пробелом внутри", [f({ key: "a b" })]],
  ["ключ с пробелом в начале", [f({ key: " a" })]],
  ["ключ с пробелом в конце", [f({ key: "a " })]],
  ["ключ кириллицей", [f({ key: "ключ" })]],
  ["ключ с подчёркивания", [f({ key: "_a" })]],
  ["ключ с двойным подчёркиванием (допустим)", [f({ key: "a__b" })]],
  ["ключ с подчёркиванием на конце (допустим)", [f({ key: "a_" })]],
  ["ключ из 31 знака (допустим)", [f({ key: "a" + "b".repeat(30) })]],
  ["ключ из 32 знаков", [f({ key: "a" + "b".repeat(31) })]],
  ["повтор ключа", [f({ key: "x" }), f({ key: "x" })]],
  ["тройной повтор ключа", [f({ key: "x" }), f({ key: "x" }), f({ key: "x" })]],
  ["два плохих ключа подряд (не повтор)", [f({ key: "Bad" }), f({ key: "Bad" })]],
  ["плохой ключ, потом такой же хороший", [f({ key: "Bad" }), f({ key: "bad" })]],
  ["подпись ru пустая", [f({ label_ru: "" })]],
  ["подпись uz пустая", [f({ label_uz: "" })]],
  ["подписи из пробелов", [f({ label_ru: "   ", label_uz: "\t" })]],
  ["обе подписи пустые", [f({ label_ru: "", label_uz: "" })]],
  ["плохой ключ и пустые подписи (сервер называет только ключ)", [f({ key: "A", label_ru: "" })]],
  ["повтор ключа и пустые подписи (сервер называет только повтор)", [f({ key: "x" }), f({ key: "x", label_ru: "" })]],
  ["select без варианта (пустой массив)", [sel({ options: [] })]],
  ["select без options вовсе", [f({ type: "select" })]],
  ["вариант без значения", [sel({ options: [opt("")] })]],
  ["вариант со значением из пробелов", [sel({ options: [opt("  ")] })]],
  ["вариант без подписи ru", [sel({ options: [opt("a", "", "У")] })]],
  ["вариант без подписи uz", [sel({ options: [opt("a", "Р", "")] })]],
  ["повтор значения варианта", [sel({ options: [opt("a"), opt("b"), opt("a")] })]],
  ["повтор значения, отличающийся пробелами: «a» и « a»", [sel({ options: [opt("a"), opt(" a")] })]],
  ["повтор значения, отличающийся пробелами: «a » и «a»", [sel({ options: [opt("a "), opt("a")] })]],
  ["плохой вариант раньше повтора", [sel({ options: [opt(""), opt("a"), opt("a")] })]],
  ["повтор раньше плохого варианта", [sel({ options: [opt("a"), opt("a"), opt("")] })]],
  ["text-поле с вариантами: их сервер отбрасывает, не проверяя", [f({ options: [opt(""), opt("")] })]],
  ["text-поле с пустым options", [f({ options: [] })]],
  ["required не true (1) сервер читает как false", [f({ required: 1 })]],
  ["подписи с пробелами по краям", [f({ label_ru: "  Р  ", label_uz: " У " })]],
  ["несколько сломанных полей подряд", [
    f({ key: "A" }),
    f({ key: "ok1" }),
    f({ key: "ok1" }),
    sel({ key: "ok2", options: [] }),
    f({ key: "ok3", label_uz: "" }),
    sel({ key: "ok4", options: [opt("v"), opt("v")] }),
  ]],
];

describe("редактор типов и validateSchema говорят одно и то же", () => {
  for (const [name, raw] of CASES) {
    it(name, () => {
      expect(firstPerField(raw)).toEqual(serverErrors(raw));
    });
  }

  it("принятая схема после приведения редактора совпадает с тем, что сохранит сервер", () => {
    // Обрезка подписей, отбрасывание options у text и порядок свойств: редактор
    // сравнивает «изменилось ли» по этому приведению, так что оно обязано
    // совпадать с серверным побуквенно.
    for (const [, raw] of CASES) {
      const r = validateSchema(raw);
      if (!r.ok) continue;
      expect(JSON.stringify(toSchema(toDrafts(raw)))).toBe(JSON.stringify(r.schema));
    }
  });

  it("сообщение в форме начинается с формулировки сервера", () => {
    for (const [, raw] of CASES) {
      for (const i of validateDrafts(toDrafts(raw))) {
        expect(i.message.toLowerCase().startsWith(i.clause.toLowerCase())).toBe(true);
      }
    }
  });

  it("случайные схемы: решение и первая ошибка каждого поля совпадают с сервером", () => {
    // mulberry32: детерминированный генератор, чтобы падение воспроизводилось.
    let seed = 20261007;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    // Среди значений вариантов есть с краевыми пробелами: «v1» и « v1» для
    // сервера и редактора одно и то же значение.
    const keys = ["a", "b", "a", "Bad", "x_1", "", "1x", "a b", "ok"];
    const labels = ["", " ", "Р", "Р", "Р"];
    const values = ["", "v1", "v2", "v1", "v3", " v1", "v2 "];
    let checked = 0;
    let rejected = 0;
    for (let n = 0; n < 3000; n++) {
      const raw: Raw = Array.from({ length: Math.floor(rnd() * 5) }, () => {
        const type = pick(["select", "text", "select"]);
        return {
          key: pick(keys),
          type,
          required: pick([true, false, 1]),
          label_ru: pick(labels),
          label_uz: pick(labels),
          ...(rnd() < 0.85
            ? {
                options: Array.from({ length: Math.floor(rnd() * 4) }, () => ({
                  value: pick(values),
                  label_ru: pick(labels),
                  label_uz: pick(labels),
                })),
              }
            : {}),
        };
      });
      expect(firstPerField(raw)).toEqual(serverErrors(raw));
      checked++;
      if (!validateSchema(raw).ok) rejected++;
    }
    // Генератор не должен вырождаться в «всё валидно» или «всё сломано».
    expect(rejected).toBeGreaterThan(300);
    expect(checked - rejected).toBeGreaterThan(30);
  });

  it("«a» и « a» отвергают оба: сервер больше не сохраняет два одинаковых варианта", () => {
    // Раньше сервер искал повтор по необрезанному значению, а сохранял
    // обрезанное, так что такая пара проходила и ложилась в схему двумя
    // вариантами «a». Теперь сервер обрезает до проверки, как редактор.
    const raw: Raw = [sel({ options: [opt("a"), opt(" a")] })];
    expect(validateSchema(raw).ok).toBe(false);
    expect(serverErrors(raw)).toEqual(["k: повторяющееся значение варианта a"]);
    expect(firstPerField(raw)).toEqual(["k: повторяющееся значение варианта a"]);
  });
});
