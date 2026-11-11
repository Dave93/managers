import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { claimBody, claimResponse, reportBody } from "./contract";

// Примеры один в один из storno_plugin/docs/protocol.md. Упало - контракт разошёлся с плагином.

describe("контракт с плагином", () => {
  it("claim: запрос плагина", () => {
    const body = {
      terminalId: "5c3d7f0e-2f4b-4d0e-9a55-0d6c0a2f9a11",
      terminalName: "Ofis Test",
      cashRegisterNumbers: [3000],
      pluginVersion: "0.1.0",
      dryRun: true,
    };
    expect(Value.Check(claimBody, body)).toBe(true);
  });

  it("claim: без имени и версии (null) тоже можно", () => {
    expect(
      Value.Check(claimBody, { terminalId: "x", terminalName: null, cashRegisterNumbers: [], pluginVersion: null, dryRun: false })
    ).toBe(true);
  });

  it("claim: dryRun обязателен, номера - целые", () => {
    expect(Value.Check(claimBody, { terminalId: "x", cashRegisterNumbers: [1] })).toBe(false);
    expect(Value.Check(claimBody, { terminalId: "x", cashRegisterNumbers: [1.5], dryRun: true })).toBe(false);
  });

  it("claim: ответ с командой", () => {
    const res = {
      command: {
        id: "3f2c1a54-0000-4000-8000-000000000001",
        orderId: "23c37166-3731-493d-ad3c-70c8b5bef91f",
        cashRegisterNumber: 3000,
        pin: "0000",
        paymentTypeId: "11111111-1111-4111-8111-111111111111",
        removalTypeId: null,
        sectionId: null,
        orderTypeId: null,
      },
    };
    expect(Value.Check(claimResponse, res)).toBe(true);
  });

  it("report: все статусы из протокола принимаются", () => {
    for (const status of ["done", "dry_run_ok", "rejected", "failed", "unknown"]) {
      expect(
        Value.Check(reportBody, { status, message: "что произошло", stornoOrderId: null, pluginVersion: "0.1.0" })
      ).toBe(true);
    }
  });

  it("report: длинное сообщение и версия НЕ отклоняются (отклонённый отчёт плагин повторял бы вечно)", () => {
    expect(
      Value.Check(reportBody, { status: "failed", message: "x".repeat(10_000), stornoOrderId: "y".repeat(500), pluginVersion: "v".repeat(100) })
    ).toBe(true);
  });

  it("report: чужой статус и отсутствие статуса отклоняются", () => {
    expect(Value.Check(reportBody, { status: "ok" })).toBe(false);
    expect(Value.Check(reportBody, { message: "x" })).toBe(false);
  });
});
