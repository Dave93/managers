import { describe, expect, it } from "bun:test";
import { attachmentPath, checkUpload, extForMime, MAX_FILES_PER_PHASE } from "./storage";

describe("правила вложений", () => {
  it("знает разрешённые типы", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/heic")).toBeNull();
    expect(extForMime("application/pdf")).toBeNull();
    expect(extForMime("video/mp4")).toBeNull();
  });

  it("пропускает обычное фото", () => {
    expect(checkUpload({ mime: "image/jpeg", size: 2_000_000, existingCount: 0 })).toEqual({ ok: true });
  });

  it("отвергает чужой тип", () => {
    const r = checkUpload({ mime: "application/pdf", size: 1000, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает файл больше 10 МБ", () => {
    const r = checkUpload({ mime: "image/png", size: 10 * 1024 * 1024 + 1, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает пустой файл", () => {
    expect(checkUpload({ mime: "image/png", size: 0, existingCount: 0 }).ok).toBe(false);
  });

  it("держит лимит в пять файлов на фазу", () => {
    expect(checkUpload({ mime: "image/png", size: 1000, existingCount: MAX_FILES_PER_PHASE - 1 }).ok).toBe(true);
    expect(checkUpload({ mime: "image/png", size: 1000, existingCount: MAX_FILES_PER_PHASE }).ok).toBe(false);
  });

  it("кладёт файл в каталог заявки со случайным именем", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const p = attachmentPath(id, "jpg");
    expect(p).toContain(`/${id}/`);
    expect(p.endsWith(".jpg")).toBe(true);
    expect(p).not.toBe(attachmentPath(id, "jpg"));
  });
});

describe("защита от типов", () => {
  it("отвергает NaN в size", () => {
    const r = checkUpload({ mime: "image/jpeg", size: NaN, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает Infinity в size", () => {
    const r = checkUpload({ mime: "image/jpeg", size: Infinity, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает отрицательное значение size", () => {
    const r = checkUpload({ mime: "image/jpeg", size: -100, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает NaN в existingCount", () => {
    const r = checkUpload({ mime: "image/jpeg", size: 1000, existingCount: NaN });
    expect(r.ok).toBe(false);
  });

  it("отвергает Infinity в existingCount", () => {
    const r = checkUpload({ mime: "image/jpeg", size: 1000, existingCount: Infinity });
    expect(r.ok).toBe(false);
  });

  it("отвергает отрицательное existingCount", () => {
    const r = checkUpload({ mime: "image/jpeg", size: 1000, existingCount: -1 });
    expect(r.ok).toBe(false);
  });

  it("отвергает null в mime", () => {
    const r = checkUpload({ mime: null as any, size: 1000, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает number в mime", () => {
    const r = checkUpload({ mime: 123 as any, size: 1000, existingCount: 0 });
    expect(r.ok).toBe(false);
  });
});

describe("защита от подмены пути", () => {
  it("не позволяет ../ в ticketId", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const normal = attachmentPath(id, "jpg");
    const dangerous = attachmentPath("../../../etc/passwd" as any, "jpg");
    // Проверяем, что нормальный путь содержит UUID
    expect(normal).toContain(`/${id}/`);
    // Проверяем, что опасный путь переадресован в /invalid/ и не содержит /etc/passwd
    expect(dangerous).toContain("/invalid/");
    expect(dangerous).not.toContain("/etc/passwd");
  });

  it("не позволяет абсолютный путь в ticketId", () => {
    const dangerous = attachmentPath("/etc/passwd" as any, "jpg");
    // Проверяем, что абсолютный путь переадресован в /invalid/ и не содержит /etc
    expect(dangerous).toContain("/invalid/");
    expect(dangerous).not.toContain("/etc/passwd");
  });
});

describe("extForMime защита", () => {
  it("отвергает null в extForMime", () => {
    const r = extForMime(null as any);
    expect(r).toBeNull();
  });

  it("отвергает number в extForMime", () => {
    const r = extForMime(123 as any);
    expect(r).toBeNull();
  });

  it("отвергает пустую строку", () => {
    const r = extForMime("");
    expect(r).toBeNull();
  });
});
