/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { FieldDef } from "./tickets-api";
import {
  CreateBlocked,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIDE,
  branchesFromRows,
  buildCreateFormData,
  buildDetails,
  describeFailure,
  fieldState,
  fitWithin,
  jpegName,
  lacksContractor,
  missingItems,
  pickBranch,
  preparePhoto,
  setFieldValue,
  sortTypes,
  type PhotoIO,
} from "./tickets-create";

// Здесь проверяется то, что на планшете ломается молча: заявка уходит не в тот
// филиал, форма пропускает пустое поле и ловит 422 после фотографий, снимок
// портретной камеры или битый файл уезжает на сервер как есть. Браузерную часть
// (canvas, <img>, камера) этим не проверить; логика решений вынесена так, что
// проверяется целиком.

const sel = (key: string, required: boolean, values: string[]): FieldDef => ({
  key,
  type: "select",
  required,
  label_ru: key.toUpperCase(),
  label_uz: key,
  options: values.map((v) => ({ value: v, label_ru: v, label_uz: v })),
});
const txt = (key: string, required: boolean): FieldDef => ({
  key,
  type: "text",
  required,
  label_ru: key.toUpperCase(),
  label_uz: key,
});

const jpeg = (name = "a.jpg", bytes = 10) => new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });

describe("лимиты", () => {
  // Числа продублированы из бэкенда, потому что админка не импортирует
  // backend. Если сервер поменяет лимит, а экран нет, менеджер увидит «5 из 5»
  // там, где сервер принимает больше, или 422 там, где экран разрешил.
  const storage = join(import.meta.dir, "../../backend/src/modules/tickets/storage.ts");
  test.skipIf(!existsSync(storage))("совпадают с backend/src/modules/tickets/storage.ts", () => {
    const src = readFileSync(storage, "utf8");
    expect(Number(/MAX_FILES_PER_PHASE\s*=\s*(\d+)/.exec(src)?.[1])).toBe(MAX_PHOTOS);
    expect(/MAX_FILE_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/.test(src)).toBe(true);
    expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("lacksContractor", () => {
  test("external без фирмы недоступен", () => {
    expect(lacksContractor({ executor_kind: "external", contractor_id: null })).toBe(true);
  });
  test("external с фирмой доступен", () => {
    expect(lacksContractor({ executor_kind: "external", contractor_id: "c1" })).toBe(false);
  });
  // staff-тип по определению без фирмы: сервер такую заявку принимает.
  test("staff без фирмы остаётся рабочим", () => {
    expect(lacksContractor({ executor_kind: "staff", contractor_id: null })).toBe(false);
  });
});

test("sortTypes: по sort, затем по названию, исходный массив цел", () => {
  const src = [
    { sort: 2, name_ru: "Б" },
    { sort: 1, name_ru: "Я" },
    { sort: 1, name_ru: "А" },
  ];
  expect(sortTypes(src).map((t) => t.name_ru)).toEqual(["А", "Я", "Б"]);
  expect(src[0].name_ru).toBe("Б");
});

describe("филиал", () => {
  const rows = [
    { terminal_id: "t2", terminals: { id: "t2", name: "Юнусабад" } },
    { terminal_id: "t1", terminals: { id: "t1", name: "Алмазар" } },
    { terminal_id: "t1", terminals: { id: "t1", name: "Алмазар" } },
    { terminal_id: "t3", terminals: null },
  ];

  test("имена из соединения, дубли убраны, порядок по имени", () => {
    const b = branchesFromRows(rows);
    expect(b.map((x) => x.name)).toEqual(["Алмазар", "Филиал t3", "Юнусабад"]);
    expect(b.filter((x) => x.id === "t1")).toHaveLength(1);
  });

  test("удалённый филиал не теряется и не остаётся без подписи", () => {
    const t3 = branchesFromRows(rows).find((x) => x.id === "t3");
    expect(t3?.name).toBe("Филиал t3");
  });

  for (const v of [null, undefined, {}, "x", []] as unknown[]) {
    test(`${JSON.stringify(v) ?? "undefined"} даёт пустой список`, () => {
      expect(branchesFromRows(v)).toEqual([]);
    });
  }

  const one = [{ id: "a", name: "A" }];
  const two = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

  test("один филиал уходит всегда, даже если выбор другой", () => {
    expect(pickBranch(one, null)).toBe("a");
    expect(pickBranch(one, "zzz")).toBe("a");
  });
  // Сервер при отсутствии terminal_id молча берёт первый терминал сессии. Экран
  // не должен повторять эту подмену: без выбора филиала нет.
  test("несколько филиалов без выбора дают null, а не первый", () => {
    expect(pickBranch(two, null)).toBeNull();
  });
  test("выбор принимается, если он есть в списке", () => {
    expect(pickBranch(two, "b")).toBe("b");
  });
  test("выбор, которого нет в списке, не принимается", () => {
    expect(pickBranch(two, "zzz")).toBeNull();
  });
  test("ни одного филиала даёт null", () => {
    expect(pickBranch([], null)).toBeNull();
    expect(pickBranch([], "a")).toBeNull();
  });
});

describe("поля схемы", () => {
  const schema = [sel("zone", true, ["hall", "kitchen"]), txt("note", false), sel("part", false, ["a", "b"])];

  test("setFieldValue не мутирует и заменяет значение", () => {
    const a = Object.freeze({ zone: "hall" });
    const b = setFieldValue(a, "zone", "kitchen");
    expect(b).toEqual({ zone: "kitchen" });
    expect(a).toEqual({ zone: "hall" });
  });

  // «constructor» — допустимый ключ схемы (snake_case). Обычное чтение values[key]
  // вернуло бы Object.prototype.constructor и посчитало поле заполненным.
  test("ключ constructor не читается из прототипа", () => {
    const f = txt("constructor", true);
    expect(fieldState(f, {})).toBe("empty");
    expect(buildDetails([f], {})).toEqual({});
    expect(missingItems({ schema: [f], values: {}, branchUnchosen: false, photoCount: 1, photosProcessing: 0 })).toEqual([
      "Заполните «CONSTRUCTOR»",
    ]);
  });
  test("значение под ключом constructor записывается собственным свойством", () => {
    const v = setFieldValue({}, "constructor", "x");
    expect(Object.prototype.hasOwnProperty.call(v, "constructor")).toBe(true);
    expect(buildDetails([txt("constructor", true)], v)).toEqual({ constructor: "x" });
  });

  test("details: обрезка, пустое опущено, ключ вне схемы не уходит", () => {
    const d = buildDetails(schema, { zone: "hall", note: "  мигает  ", part: "", gone: "1" });
    expect(d).toEqual({ zone: "hall", note: "мигает" });
    expect("gone" in d).toBe(false);
  });
  test("вариант, которого нет в схеме, не уходит и считается неверным", () => {
    expect(buildDetails(schema, { zone: "toilet" })).toEqual({});
    expect(fieldState(schema[0], { zone: "toilet" })).toBe("invalid");
  });
  test("текст длиннее 2000 неверен, ровно 2000 годится", () => {
    expect(fieldState(schema[1], { note: "x".repeat(2000) })).toBe("ok");
    expect(fieldState(schema[1], { note: "x".repeat(2001) })).toBe("invalid");
  });
  test("пробелы вместо значения — пусто", () => {
    expect(fieldState(schema[0], { zone: "   " })).toBe("empty");
  });
});

describe("missingItems", () => {
  const schema = [sel("zone", true, ["hall"]), txt("note", true), sel("opt", false, ["a"])];
  const base = { schema, values: {}, branchUnchosen: false, photoCount: 0, photosProcessing: 0 };

  test("перечисляет всё недостающее по порядку: филиал, поля, фото", () => {
    expect(missingItems({ ...base, branchUnchosen: true })).toEqual([
      "Выберите филиал",
      "Выберите «ZONE»",
      "Заполните «NOTE»",
      "Добавьте хотя бы одну фотографию",
    ]);
  });
  // Сервер отвечает 422 «Нужна хотя бы одна фотография»; в плане этого требования нет.
  test("без фотографии отправить нельзя, даже когда поля заполнены", () => {
    expect(missingItems({ ...base, values: { zone: "hall", note: "x" } })).toEqual([
      "Добавьте хотя бы одну фотографию",
    ]);
  });
  test("пока фотографии жмутся, ждём их, а не просим добавить", () => {
    expect(missingItems({ ...base, values: { zone: "hall", note: "x" }, photosProcessing: 2 })).toEqual([
      "Дождитесь обработки фотографий",
    ]);
  });
  test("всё заполнено — ничего не требуется", () => {
    expect(missingItems({ ...base, values: { zone: "hall", note: "x" }, photoCount: 1 })).toEqual([]);
  });
  test("необязательное поле не требуется, но неверное значение блокирует", () => {
    expect(missingItems({ ...base, values: { zone: "hall", note: "x", opt: "zzz" }, photoCount: 1 })).toEqual([
      "Проверьте поле «OPT»",
    ]);
  });
});

describe("buildCreateFormData", () => {
  const ok = {
    typeId: "11111111-1111-4111-8111-111111111111",
    terminalId: "22222222-2222-4222-8222-222222222222",
    priority: "urgent" as const,
    details: { zone: "hall" },
    description: "  дверь  ",
    photos: [jpeg("one.jpg"), jpeg("two.jpg")],
  };

  // Сериализуем так же, как это делает fetch, и читаем обратно парсером
  // multipart: проверяется то, что увидит сервер, а не наш объект FormData.
  const roundTrip = async (fd: FormData) => {
    const req = new Request("http://x/api/tickets", { method: "POST", body: fd });
    expect(req.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    return req.formData();
  };

  test("поля и файлы доходят в том виде, в каком их ждёт роут", async () => {
    const out = await roundTrip(buildCreateFormData(ok));
    expect(out.get("type_id")).toBe(ok.typeId);
    expect(out.get("terminal_id")).toBe(ok.terminalId);
    expect(out.get("priority")).toBe("urgent");
    expect(JSON.parse(String(out.get("details")))).toEqual({ zone: "hall" });
    expect(out.get("description")).toBe("дверь");
    const files = out.getAll("photos") as File[];
    expect(files.map((f) => f.name)).toEqual(["one.jpg", "two.jpg"]);
    expect(files.map((f) => f.type)).toEqual(["image/jpeg", "image/jpeg"]);
  });
  test("файлы лежат под ключом photos, а не photos[]", async () => {
    const out = await roundTrip(buildCreateFormData(ok));
    expect([...out.keys()].filter((k) => k.startsWith("photos"))).toEqual(["photos", "photos"]);
  });
  test("пустой комментарий не отправляется", async () => {
    const out = await roundTrip(buildCreateFormData({ ...ok, description: "   " }));
    expect(out.has("description")).toBe(false);
  });

  // Пункт 2 из Review Focus на уровне запроса: даже если экран открыт каким-то
  // образом без филиала, тело не собирается, и сеть не затрагивается.
  for (const terminalId of [null, "", "   "]) {
    test(`без филиала (${JSON.stringify(terminalId)}) запрос не собирается`, () => {
      expect(() => buildCreateFormData({ ...ok, terminalId })).toThrow(CreateBlocked);
    });
  }
  test("без фотографий и с лишними запрос не собирается", () => {
    expect(() => buildCreateFormData({ ...ok, photos: [] })).toThrow(CreateBlocked);
    const six = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => jpeg(`${i}.jpg`));
    expect(() => buildCreateFormData({ ...ok, photos: six })).toThrow(CreateBlocked);
    expect(() => buildCreateFormData({ ...ok, photos: six.slice(0, MAX_PHOTOS) })).not.toThrow();
  });
  test("без типа запрос не собирается", () => {
    expect(() => buildCreateFormData({ ...ok, typeId: "" })).toThrow(CreateBlocked);
  });
});

describe("describeFailure", () => {
  const http = (status: number, message: string, errors?: string[]) => Object.assign(new Error(message), { status, errors });

  test("обрыв сети: исход неизвестен, повторять вслепую нельзя", () => {
    const f = describeFailure(new Error("Нет связи с сервером"));
    expect(f.outcomeUnknown).toBe(true);
    expect(f.message).toContain("проверьте");
  });
  test("502/504: тоже неизвестно", () => {
    expect(describeFailure(http(504, "x")).outcomeUnknown).toBe(true);
    expect(describeFailure(http(502, "x")).outcomeUnknown).toBe(true);
  });
  test("500 с ответом сервера: заявки нет, исход известен", () => {
    const f = describeFailure(http(500, "Не удалось создать заявку"));
    expect(f.outcomeUnknown).toBe(false);
    expect(f.message).toBe("Не удалось создать заявку");
  });
  test("422 приводит ошибки полей и просит обновить типы", () => {
    const f = describeFailure(http(422, "Поля заполнены неверно", ["zone: обязательное поле"]));
    expect(f.message).toContain("zone: обязательное поле");
    expect(f.refetchTypes).toBe(true);
  });
  test("404 (тип отключён) просит обновить типы", () => {
    expect(describeFailure(http(404, "Тип заявки не найден")).refetchTypes).toBe(true);
  });
  test("403 «Филиал недоступен» объясняет, что делать", () => {
    expect(describeFailure(http(403, "Филиал недоступен")).message).toContain("войдите заново");
  });
  test("отказ до сети читается как отказ экрана", () => {
    const f = describeFailure(new CreateBlocked("Заявка не отправлена: не выбран филиал."));
    expect(f.outcomeUnknown).toBe(false);
    expect(f.message).toContain("не выбран филиал");
  });
});

describe("фотографии: размеры и имена", () => {
  test("fitWithin сохраняет пропорции и не увеличивает", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(100000, 1)).toEqual({ width: 1600, height: 1 });
  });
  test("jpegName", () => {
    expect(jpegName("a.jpg")).toBe("a.jpg");
    expect(jpegName("A.JPEG")).toBe("A.JPEG");
    expect(jpegName("shot.png")).toBe("shot.jpg");
    expect(jpegName("photo.final.webp")).toBe("photo.final.jpg");
    expect(jpegName("noext")).toBe("noext.jpg");
    expect(jpegName("")).toBe("photo.jpg");
  });
});

describe("preparePhoto", () => {
  type Img = { w: number; h: number };
  const fakeIO = (opts: {
    dims?: { w: number; h: number };
    decodeFails?: boolean;
    encoded?: Blob | null | "throw";
  }) => {
    const calls = { encode: [] as Array<[number, number]>, released: 0 };
    const io: PhotoIO<Img> = {
      async decode() {
        if (opts.decodeFails) throw new Error("bad");
        const d = opts.dims ?? { w: 4000, h: 3000 };
        return { image: d, width: d.w, height: d.h };
      },
      async encode(_i, w, h) {
        calls.encode.push([w, h]);
        if (opts.encoded === "throw") throw new Error("canvas");
        return opts.encoded === undefined ? new Blob([new Uint8Array(500)], { type: "image/jpeg" }) : opts.encoded;
      },
      release() {
        calls.released++;
      },
    };
    return { io, calls };
  };
  const bigJpeg = () => jpeg("IMG_1.jpg", 4_000_000);

  test("большая фотография сжимается до 1600, имя и тип сохраняются", async () => {
    const { io, calls } = fakeIO({});
    const r = await preparePhoto(bigJpeg(), io);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.recompressed).toBe(true);
    expect(r.file.name).toBe("IMG_1.jpg");
    expect(r.file.type).toBe("image/jpeg");
    expect(r.file.size).toBe(500);
    expect(calls.encode).toEqual([[1600, 1200]]);
    expect(calls.released).toBe(1);
  });
  test("портрет: длинная сторона — высота", async () => {
    const { io, calls } = fakeIO({ dims: { w: 3000, h: 4000 } });
    await preparePhoto(bigJpeg(), io);
    expect(calls.encode).toEqual([[1200, 1600]]);
  });
  // PNG, ужатый в JPEG, не должен остаться с именем .png и типом image/png:
  // сервер берёт расширение из mime, и под одним именем лежали бы чужие байты.
  test("PNG, который пришлось сжать, становится .jpg с типом image/jpeg", async () => {
    const { io } = fakeIO({});
    const r = await preparePhoto(new File([new Uint8Array(3_000_000)], "screen.png", { type: "image/png" }), io);
    if (!r.ok) throw new Error(r.error);
    expect(r.file.name).toBe("screen.jpg");
    expect(r.file.type).toBe("image/jpeg");
  });
  test("маленький годный файл уходит как есть, без перекодирования", async () => {
    const { io, calls } = fakeIO({ dims: { w: 1200, h: 900 } });
    const f = jpeg("small.jpg", 200_000);
    const r = await preparePhoto(f, io);
    if (!r.ok) throw new Error(r.error);
    expect(r.file).toBe(f);
    expect(r.recompressed).toBe(false);
    expect(calls.encode).toHaveLength(0);
  });
  test("toBlob вернул null: уходит оригинал, а не ошибка", async () => {
    const { io } = fakeIO({ encoded: null });
    const f = bigJpeg();
    const r = await preparePhoto(f, io);
    if (!r.ok) throw new Error(r.error);
    expect(r.file).toBe(f);
  });
  test("canvas бросил исключение: тоже оригинал", async () => {
    const { io } = fakeIO({ encoded: "throw" });
    const f = bigJpeg();
    const r = await preparePhoto(f, io);
    expect(r.ok && r.file === f).toBe(true);
  });
  test("toBlob вернул не JPEG (Safari подставляет PNG): считаем неудачей", async () => {
    const { io } = fakeIO({ encoded: new Blob([new Uint8Array(500)], { type: "image/png" }) });
    const f = bigJpeg();
    const r = await preparePhoto(f, io);
    expect(r.ok && r.file === f).toBe(true);
  });
  test("результат не меньше оригинала: остаётся оригинал", async () => {
    const { io } = fakeIO({ encoded: new Blob([new Uint8Array(5_000_000)], { type: "image/jpeg" }) });
    const f = bigJpeg();
    const r = await preparePhoto(f, io);
    expect(r.ok && r.file === f).toBe(true);
  });

  // Требование, которого нет в плане: файл, который браузер не может открыть
  // (переименованный .txt, HEIC без поддержки), отклоняется при выборе.
  test("нечитаемый файл отклоняется с понятным текстом", async () => {
    const { io, calls } = fakeIO({ decodeFails: true });
    const r = await preparePhoto(new File(["не картинка"], "notes.jpg", { type: "image/jpeg" }), io);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.error).toContain("notes.jpg");
    expect(r.error).toContain("не удаётся открыть как изображение");
    expect(calls.encode).toHaveLength(0);
  });
  test("пустой файл отклоняется", async () => {
    const { io } = fakeIO({});
    const r = await preparePhoto(new File([], "e.jpg", { type: "image/jpeg" }), io);
    expect(r.ok).toBe(false);
  });
  test("тип не JPEG/PNG, но файл читается: перекодируется в JPEG", async () => {
    const { io } = fakeIO({ dims: { w: 800, h: 600 } });
    const r = await preparePhoto(new File([new Uint8Array(900)], "p.webp", { type: "image/webp" }), io);
    if (!r.ok) throw new Error(r.error);
    expect(r.file.name).toBe("p.jpg");
    expect(r.file.type).toBe("image/jpeg");
  });
  test("тип не JPEG/PNG и перекодировать не вышло: отказ, не отправка негодного", async () => {
    const { io } = fakeIO({ dims: { w: 800, h: 600 }, encoded: null });
    const r = await preparePhoto(new File([new Uint8Array(900)], "p.webp", { type: "image/webp" }), io);
    expect(r.ok).toBe(false);
  });
  test("пустой mime у читаемого файла: тоже перекодируется", async () => {
    const { io } = fakeIO({ dims: { w: 800, h: 600 } });
    const r = await preparePhoto(new File([new Uint8Array(900)], "camera", { type: "" }), io);
    if (!r.ok) throw new Error(r.error);
    expect(r.file.type).toBe("image/jpeg");
  });
  test("оригинал больше 10 МБ и сжатие не удалось: отказ", async () => {
    const { io } = fakeIO({ dims: { w: 1000, h: 800 }, encoded: null });
    const r = await preparePhoto(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "huge.png", { type: "image/png" }), io);
    expect(r.ok).toBe(false);
  });
  test("после сжатия всё ещё больше 10 МБ: отказ", async () => {
    const { io } = fakeIO({
      dims: { w: 5000, h: 5000 },
      encoded: new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)], { type: "image/jpeg" }),
    });
    const r = await preparePhoto(new File([new Uint8Array(MAX_PHOTO_BYTES + 10)], "huge.jpg", { type: "image/jpeg" }), io);
    expect(r.ok).toBe(false);
  });
  test("размер 0x0 отклоняется", async () => {
    const { io } = fakeIO({ dims: { w: 0, h: 0 } });
    expect((await preparePhoto(bigJpeg(), io)).ok).toBe(false);
  });
  test("кадр освобождается в любом исходе", async () => {
    for (const encoded of [null, "throw" as const, undefined]) {
      const { io, calls } = fakeIO({ encoded });
      await preparePhoto(bigJpeg(), io);
      expect(calls.released).toBe(1);
    }
  });
  test("MAX_PHOTO_SIDE равен 1600", () => {
    expect(MAX_PHOTO_SIDE).toBe(1600);
  });
});
