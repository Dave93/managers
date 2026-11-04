import { expect, it } from "bun:test";
import { MAX_PHOTO_SIDE, fitWithin, preparePhoto } from "../src/photo-prepare";

const MAX = 10 * 1024 * 1024;
const file = (size: number, type: string, name = "p.jpg") => new File([new Uint8Array(size)], name, { type });
const io = (o: { w?: number; h?: number; fail?: boolean; out?: Blob | null }) => {
  const calls = { encode: [] as [number, number][], release: 0 };
  return { calls, io: {
    decode: async () => { if (o.fail) throw new Error("decode"); return { image: "img", width: o.w ?? 800, height: o.h ?? 600 }; },
    encode: async (_i: string, w: number, h: number) => { calls.encode.push([w, h]); return o.out === undefined ? new Blob([new Uint8Array(1000)], { type: "image/jpeg" }) : o.out; },
    release: () => { calls.release++; },
  } };
};
it("fitWithin: длинная сторона не больше 1600, пропорции сохраняются", () => {
  expect(MAX_PHOTO_SIDE).toBe(1600);
  expect(fitWithin(3000, 2000)).toEqual({ width: 1600, height: 1067 });
  expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
});
it("небольшой JPEG уходит как есть", async () => {
  const f = file(500_000, "image/jpeg"); const t = io({});
  expect(await preparePhoto(f, t.io, MAX)).toEqual({ ok: true, file: f, recompressed: false });
  expect([t.calls.encode.length, t.calls.release]).toEqual([0, 1]);
});
it("кадр 4000×3000 жмётся до 1600×1200 в JPEG, имя получает .jpg", async () => {
  const t = io({ w: 4000, h: 3000 });
  const r = await preparePhoto(file(6_000_000, "image/png", "IMG_1.png"), t.io, MAX);
  expect(r).toMatchObject({ ok: true, recompressed: true });
  if (r.ok) expect([r.file.type, r.file.name]).toEqual(["image/jpeg", "IMG_1.jpg"]);
  expect(t.calls.encode).toEqual([[1600, 1200]]);
});
it("PNG больше 10 МБ при малых сторонах перекодируется; результат всё ещё больше предела — too_big", async () => {
  expect((await preparePhoto(file(12 * 1024 * 1024, "image/png"), io({}).io, MAX)).ok).toBe(true);
  const big = io({ out: new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "image/jpeg" }) });
  expect(await preparePhoto(file(12 * 1024 * 1024, "image/png"), big.io, MAX)).toEqual({ ok: false, reason: "too_big" });
});
it("HEIC и нечитаемое — decode; пустой файл — empty; encode null: годный оригинал уходит, негодный — prepare", async () => {
  expect(await preparePhoto(file(900_000, "image/heic", "a.heic"), io({ fail: true }).io, MAX)).toEqual({ ok: false, reason: "decode" });
  expect(await preparePhoto(file(0, "image/jpeg"), io({}).io, MAX)).toEqual({ ok: false, reason: "empty" });
  const f = file(2_000_000, "image/jpeg");
  expect(await preparePhoto(f, io({ w: 4000, h: 3000, out: null }).io, MAX)).toEqual({ ok: true, file: f, recompressed: false });
  expect(await preparePhoto(file(900_000, "image/heic"), io({ w: 4000, h: 3000, out: null }).io, MAX)).toEqual({ ok: false, reason: "prepare" });
});
it("результат не меньше оригинала — уходит оригинал", async () => {
  const f = file(900, "image/jpeg");
  expect(await preparePhoto(f, io({ w: 2000, h: 1000 }).io, MAX)).toEqual({ ok: true, file: f, recompressed: false });
});
