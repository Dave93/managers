import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { verifyInitData } from "./tg-auth";

const BOT = "123456:TEST_TOKEN";
function sign(params: Record<string, string>): string {
  const dataCheck = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

describe("verifyInitData", () => {
  const NOW = 1_800_000_000;
  const user = JSON.stringify({ id: 42, first_name: "Abror" });
  test("valid init data passes", () => {
    const init = sign({ auth_date: String(NOW - 60), user, start_param: "inv_x" });
    const res = verifyInitData(init, BOT, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.telegramId).toBe(42); expect(res.startParam).toBe("inv_x"); }
  });
  test("tampered hash fails", () => {
    const init = sign({ auth_date: String(NOW - 60), user }) + "x";
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });
  test("stale auth_date fails", () => {
    const init = sign({ auth_date: String(NOW - 90_000), user });
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });

  // Extra guards beyond the brief's three: each of these is a way a stranger
  // could try to walk in, so each gets a test.
  test("missing hash fails", () => {
    expect(verifyInitData("auth_date=" + NOW + "&user=" + encodeURIComponent(user), BOT, NOW).ok).toBe(false);
  });
  test("init data signed with a different bot token fails", () => {
    const dataCheck = [`auth_date=${NOW - 60}`, `user=${user}`].join("\n");
    const secret = createHmac("sha256", "WebAppData").update("999:OTHER").digest();
    const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
    const init = new URLSearchParams({ auth_date: String(NOW - 60), user, hash }).toString();
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });
  test("hash of a wrong length does not throw (timingSafeEqual guard)", () => {
    const init = new URLSearchParams({ auth_date: String(NOW - 60), user, hash: "ab" }).toString();
    expect(() => verifyInitData(init, BOT, NOW)).not.toThrow();
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });
  test("no user payload fails", () => {
    const init = sign({ auth_date: String(NOW - 60) });
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });
  test("start_param is null when absent", () => {
    const init = sign({ auth_date: String(NOW - 60), user });
    const res = verifyInitData(init, BOT, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.startParam).toBe(null);
  });
  test("auth_date just inside 24h passes, just outside fails", () => {
    const inside = sign({ auth_date: String(NOW - 86_400), user });
    expect(verifyInitData(inside, BOT, NOW).ok).toBe(true);
    const outside = sign({ auth_date: String(NOW - 86_401), user });
    expect(verifyInitData(outside, BOT, NOW).ok).toBe(false);
  });
});
