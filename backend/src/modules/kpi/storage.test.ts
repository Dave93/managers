import { describe, expect, it } from "bun:test";
import { checkPhoto, MAX_PHOTO_BYTES } from "./storage";

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
