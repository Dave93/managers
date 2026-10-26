import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPhoto, MAX_PHOTO_BYTES, resolveUploadFile } from "./storage";

describe("kpi: checkPhoto", () => {
  it("JPEG и PNG проходят", () => {
    expect(checkPhoto({ type: "image/png", size: 4 }, 0)).toBeNull();
    expect(checkPhoto({ type: "image/jpeg", size: MAX_PHOTO_BYTES }, 2)).toBeNull();
  });
  it("другой тип — bad_photo_type", () => {
    expect(checkPhoto({ type: "image/gif", size: 4 }, 0)).toBe("bad_photo_type");
    expect(checkPhoto({ type: "", size: 4 }, 0)).toBe("bad_photo_type");
    expect(checkPhoto({ type: "constructor", size: 4 }, 0)).toBe("bad_photo_type");
  });
  it("пустой файл — bad_photo_type, больше 10 МБ — photo_too_large", () => {
    expect(checkPhoto({ type: "image/png", size: 0 }, 0)).toBe("bad_photo_type");
    expect(checkPhoto({ type: "image/png", size: MAX_PHOTO_BYTES + 1 }, 0)).toBe("photo_too_large");
  });
  it("четвёртое фото — too_many_photos", () => {
    expect(checkPhoto({ type: "image/png", size: 4 }, 3)).toBe("too_many_photos");
  });
});

describe("kpi: resolveUploadFile", () => {
  // Юнит-тесты идут одним процессом: каталог загрузок подменяем и возвращаем как было.
  let prev: string | undefined;
  let root: string;
  let base: string;

  beforeAll(() => {
    prev = process.env.KPI_UPLOADS_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-storage-"));
    base = path.join(root, "uploads");
    fs.mkdirSync(path.join(base, "v1"), { recursive: true });
    fs.writeFileSync(path.join(base, "v1", "a.png"), "x");
    // Соседний каталог с тем же началом имени и файл рядом с каталогом загрузок.
    fs.mkdirSync(path.join(root, "uploads_evil"), { recursive: true });
    fs.writeFileSync(path.join(root, "uploads_evil", "a.png"), "x");
    fs.writeFileSync(path.join(root, "outside.png"), "x");
    process.env.KPI_UPLOADS_DIR = base;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.KPI_UPLOADS_DIR;
    else process.env.KPI_UPLOADS_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("файл внутри каталога загрузок — абсолютный путь", () => {
    expect(resolveUploadFile(`${base}/v1/a.png`)).toBe(path.resolve(base, "v1", "a.png"));
    expect(resolveUploadFile(`${base}/v1/../v1/a.png`)).toBe(path.resolve(base, "v1", "a.png"));
  });
  it("выход наверх через ../ — null, даже если файл есть", () => {
    expect(fs.existsSync(path.join(root, "outside.png"))).toBe(true);
    expect(resolveUploadFile(`${base}/../outside.png`)).toBeNull();
    expect(resolveUploadFile(`${base}/v1/../../outside.png`)).toBeNull();
  });
  it("соседний каталог с тем же префиксом имени — null", () => {
    expect(fs.existsSync(`${base}_evil/a.png`)).toBe(true);
    expect(resolveUploadFile(`${base}_evil/a.png`)).toBeNull();
  });
  it("файла нет или путь — сам каталог загрузок — null", () => {
    expect(resolveUploadFile(`${base}/v1/missing.png`)).toBeNull();
    expect(resolveUploadFile(base)).toBeNull();
  });
});
