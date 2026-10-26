import { expect, it } from "bun:test";
import { verifyInitData } from "@backend/modules/passport/tg-auth";
import { signInitData, tokenAllowed } from "./init-data";

it("signInitData проходит verifyInitData тем же токеном и не проходит чужим", () => {
  const s = signInitData("123:abc", { telegram_id: 9100000001, auth_date: 1_800_000_000 });
  expect(verifyInitData(s, "123:abc", 1_800_000_100)).toEqual({ ok: true, telegramId: 9100000001, firstName: "Тест", startParam: null });
  expect(verifyInitData(s, "123:other", 1_800_000_100)).toEqual({ ok: false, error: "bad_hash" });
});

it("tokenAllowed: тестовые токены только под managers_test_ и managers_smoke_", () => {
  for (const t of ["123456:kpi-test-bot-token", "123456:kpi-smoke-dev-token"]) {
    expect([tokenAllowed(t, "managers_test_"), tokenAllowed(t, "managers_smoke_")]).toEqual([true, true]);
    expect([tokenAllowed(t, "managers_"), tokenAllowed(t, ""), tokenAllowed(t, undefined)]).toEqual([false, false, false]);
  }
  expect([tokenAllowed("7700000000:AAEexampleRealLookingToken_0123456789", "managers_"), tokenAllowed("123456:other", "managers_")])
    .toEqual([true, true]);
});

it("tokenAllowed: пробелы вокруг тестового токена не обходят проверку", () => {
  for (const t of [" 123456:kpi-test-bot-token", "\t123456:kpi-smoke-dev-token\n", "  123456:kpi-x"]) {
    expect([tokenAllowed(t, "managers_"), tokenAllowed(t, undefined), tokenAllowed(t, "managers_test_")]).toEqual([false, false, true]);
  }
});
