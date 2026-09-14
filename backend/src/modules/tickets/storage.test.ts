import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { attachmentPath, checkUpload, extForMime, MAX_FILES_PER_PHASE, uploadsBase, saveAttachment } from "./storage";

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
  it("отвергает NaN в size с правильным сообщением", () => {
    const r = checkUpload({ mime: "image/jpeg", size: NaN, existingCount: 0 });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("некорректный размер файла");
    }
  });

  it("отвергает Infinity в size с правильным сообщением", () => {
    const r = checkUpload({ mime: "image/jpeg", size: Infinity, existingCount: 0 });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe("некорректный размер файла");
    }
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

describe("защита от подмены пути в attachmentPath", () => {
  it("выбрасывает ошибку при ../ в ticketId", () => {
    expect(() => attachmentPath("../../../etc/passwd" as any, "jpg")).toThrow();
  });

  it("выбрасывает ошибку при абсолютном пути в ticketId", () => {
    expect(() => attachmentPath("/etc/passwd" as any, "jpg")).toThrow();
  });

  it("выбрасывает ошибку при null в ticketId", () => {
    expect(() => attachmentPath(null as any, "jpg")).toThrow();
  });

  it("выбрасывает ошибку при undefined в ticketId", () => {
    expect(() => attachmentPath(undefined as any, "jpg")).toThrow();
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

describe("saveAttachment", () => {
  let tempDir: string;
  let originalDir: string | undefined;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tickets-"));
    originalDir = process.env.TICKETS_UPLOADS_DIR;
    process.env.TICKETS_UPLOADS_DIR = tempDir;
  });

  afterAll(() => {
    if (originalDir !== undefined) {
      process.env.TICKETS_UPLOADS_DIR = originalDir;
    } else {
      delete process.env.TICKETS_UPLOADS_DIR;
    }
    // Remove temp directory
    try {
      const files = fs.readdirSync(tempDir, { recursive: true, withFileTypes: true });
      for (const file of files.reverse()) {
        if (file.isDirectory()) {
          fs.rmdirSync(path.join(tempDir, file.name));
        } else {
          fs.unlinkSync(path.join(tempDir, file.name));
        }
      }
      fs.rmdirSync(tempDir);
    } catch (e) {
      // ignore cleanup errors
    }
  });

  it("сохраняет валидный image/png файл и возвращает метаданные", async () => {
    const ticketId = "11111111-2222-3333-4444-555555555555";
    const fileData = new Uint8Array([137, 80, 78, 71]); // PNG signature
    const file = new File([fileData], "test.png", { type: "image/png" });
    
    const result = await saveAttachment(file, ticketId);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Проверяем метаданные
      expect(result.mime).toBe("image/png");
      expect(result.size_bytes).toBe(4);
      expect(result.file_path).toContain(`/${ticketId}/`);
      expect(result.file_path).toContain(tempDir);
      
      // Проверяем что файл существует на диске
      expect(fs.existsSync(result.file_path)).toBe(true);
      
      // Проверяем содержимое
      const diskData = fs.readFileSync(result.file_path);
      expect(diskData.length).toBe(4);
    }
  });

  it("использует расширение из MIME, не из имени файла", async () => {
    const ticketId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const fileData = new Uint8Array([137, 80, 78, 71]); // PNG signature
    const file = new File([fileData], "payload.exe", { type: "image/png" });
    
    const result = await saveAttachment(file, ticketId);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Расширение должно быть .png, не .exe
      expect(result.file_path.endsWith(".png")).toBe(true);
      expect(result.file_path.endsWith(".exe")).toBe(false);
    }
  });

  it("отвергает недопустимый тип без записи на диск", async () => {
    const ticketId = "11111111-2222-3333-4444-555555555555";
    const fileData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // PDF signature
    const file = new File([fileData], "test.pdf", { type: "application/pdf" });
    
    const dirBefore = fs.readdirSync(tempDir).length;
    const result = await saveAttachment(file, ticketId);
    const dirAfter = fs.readdirSync(tempDir).length;
    
    expect(result.ok).toBe(false);
    expect(dirBefore).toBe(dirAfter); // Никаких новых файлов
  });

  it("отвергает некорректный ticketId без записи на диск", async () => {
    const fileData = new Uint8Array([137, 80, 78, 71]); // PNG signature
    const file = new File([fileData], "test.png", { type: "image/png" });
    
    const dirBefore = fs.readdirSync(tempDir).length;
    const result = await saveAttachment(file, "../../../etc/passwd");
    const dirAfter = fs.readdirSync(tempDir).length;
    
    expect(result.ok).toBe(false);
    expect(dirBefore).toBe(dirAfter); // Никаких новых файлов
  });

  it("сообщает путь до записи через onPath, даже если запись потом упадёт", async () => {
    const ticketId = "cccccccc-dddd-eeee-ffff-000000000000";
    const fileData = new Uint8Array([137, 80, 78, 71]); // PNG signature
    const file = new File([fileData], "test.png", { type: "image/png" });

    let reportedPath: string | undefined;
    const result = await saveAttachment(file, ticketId, (p) => {
      reportedPath = p;
    });

    // onPath получает путь синхронно до Bun.write — вызывающий код может
    // использовать его для отката файла, даже не дожидаясь результата.
    expect(reportedPath).toBeDefined();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(reportedPath).toBe(result.file_path);
    }
  });
});
