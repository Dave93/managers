import { describe, test, expect } from "bun:test";
import {
  iikoTsToIso,
  businessDateOf,
  parseGroupsXml,
  parseEmployeesXml,
  mapShift,
  aggregateCashiers,
  reconcile,
  addDays,
  dateChunks,
  tashkentToday,
  chunk,
  type MapContext,
} from "./parse";

const GROUPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><groupDtoes>
<groupDto><id>b51063f2-2fa0-459d-8f7c-94b8650dcb0f</id><name>Chopar Pizza Ko'kcha</name>
<pointOfSaleDtoes><pointOfSaleDto><id>2728b30c-ecf9-4982-9111-d2ae09357d71</id><name>Kassa</name><main>false</main></pointOfSaleDto></pointOfSaleDtoes></groupDto>
<groupDto><id>02d19593-6072-48d8-9937-88615b52cb39</id><name>CESIM CEF</name><pointOfSaleDtoes/></groupDto>
</groupDtoes>`;

const EMPLOYEES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><employees>
<employee><id>e5e7f423-29c5-4e9d-9b4f-f16065fb4423</id><code>1</code><name>Behruz</name></employee>
<employee><id>68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2</id><code>2</code><name>Komron Polatov</name></employee>
</employees>`;

const RAW_SHIFT = {
  id: "0c6e812a-9697-4c19-85ff-4db59c5cdaa0",
  sessionNumber: 889,
  fiscalNumber: null,
  cashRegNumber: 1022,
  cashRegSerial: null,
  openDate: "2026-09-09T08:59:34.304",
  closeDate: "2026-09-09T21:19:14.45",
  acceptDate: null,
  managerId: "68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2",
  responsibleUserId: "e5e7f423-29c5-4e9d-9b4f-f16065fb4423",
  sessionStartCash: 0,
  payOrders: 11343000,
  sumWriteoffOrders: 0,
  salesCash: 6037000,
  salesCredit: 0,
  salesCard: 5306000,
  payIn: 0,
  payOut: 0,
  payIncome: -6037000,
  cashRemain: 0,
  cashDiff: -6037000,
  sessionStatus: "UNACCEPTED",
  conceptionId: "622659d4-066e-4773-b1d7-d769253b6e60",
  pointOfSaleId: "2728b30c-ecf9-4982-9111-d2ae09357d71",
};

async function ctx(): Promise<MapContext> {
  return {
    pos: await parseGroupsXml(GROUPS_XML),
    terminalByGroup: new Map([
      ["b51063f2-2fa0-459d-8f7c-94b8650dcb0f", "11111111-1111-1111-1111-111111111111"],
    ]),
    names: await parseEmployeesXml(EMPLOYEES_XML),
    registerNames: new Map([[RAW_SHIFT.id, "21018 Kukcha kassa"]]),
    syncedAt: "2026-09-10T04:30:00.000Z",
  };
}

describe("time helpers", () => {
  test("iikoTsToIso appends Tashkent offset and keeps fraction as is", () => {
    expect(iikoTsToIso("2026-09-09T21:19:14.45")).toBe("2026-09-09T21:19:14.45+05:00");
    expect(iikoTsToIso("2026-09-09T09:01:17.073")).toBe("2026-09-09T09:01:17.073+05:00");
    expect(iikoTsToIso("2026-09-09 09:01:17")).toBe("2026-09-09T09:01:17+05:00");
  });
  test("iikoTsToIso rejects unexpected shapes", () => {
    expect(() => iikoTsToIso("2026-09-09T09:01:17Z")).toThrow("unexpected iiko timestamp");
    expect(() => iikoTsToIso("garbage")).toThrow("unexpected iiko timestamp");
  });
  test("businessDateOf takes the local calendar date of opening", () => {
    expect(businessDateOf("2026-09-09T01:31:56.316")).toBe("2026-09-09");
  });
  test("addDays and dateChunks", () => {
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(dateChunks("2026-06-12", "2026-06-25")).toEqual([
      { from: "2026-06-12", to: "2026-06-18" },
      { from: "2026-06-19", to: "2026-06-25" },
    ]);
    expect(dateChunks("2026-09-07", "2026-09-10")).toEqual([
      { from: "2026-09-07", to: "2026-09-10" },
    ]);
    expect(() => dateChunks("2026-09-10", "2026-09-01")).toThrow();
  });
  test("tashkentToday shifts UTC by five hours", () => {
    expect(tashkentToday(new Date("2026-09-09T19:30:00Z"))).toBe("2026-09-10");
    expect(tashkentToday(new Date("2026-09-09T18:59:00Z"))).toBe("2026-09-09");
  });
  test("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("xml", () => {
  test("parseGroupsXml maps point of sale to its group and skips empty groups", async () => {
    const pos = await parseGroupsXml(GROUPS_XML);
    expect(pos.size).toBe(1);
    expect(pos.get("2728b30c-ecf9-4982-9111-d2ae09357d71")).toEqual({
      groupId: "b51063f2-2fa0-459d-8f7c-94b8650dcb0f",
      groupName: "Chopar Pizza Ko'kcha",
      posName: "Kassa",
    });
  });
  test("parseEmployeesXml maps id to name", async () => {
    const names = await parseEmployeesXml(EMPLOYEES_XML);
    expect(names.get("68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2")).toBe("Komron Polatov");
  });
});

describe("mapShift", () => {
  test("maps a real shift to a row", async () => {
    const row = mapShift(RAW_SHIFT, await ctx());
    expect(row).toEqual({
      id: RAW_SHIFT.id,
      terminal_id: "11111111-1111-1111-1111-111111111111",
      iiko_group_id: "b51063f2-2fa0-459d-8f7c-94b8650dcb0f",
      iiko_group_name: "Chopar Pizza Ko'kcha",
      point_of_sale_id: "2728b30c-ecf9-4982-9111-d2ae09357d71",
      cash_reg_number: 1022,
      cash_register_name: "21018 Kukcha kassa",
      session_number: 889,
      open_at: "2026-09-09T08:59:34.304+05:00",
      close_at: "2026-09-09T21:19:14.45+05:00",
      business_date: "2026-09-09",
      status: "UNACCEPTED",
      responsible_user_id: "e5e7f423-29c5-4e9d-9b4f-f16065fb4423",
      responsible_user_name: "Behruz",
      manager_id: "68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2",
      manager_name: "Komron Polatov",
      pay_orders: "11343000",
      sales_cash: "6037000",
      sales_card: "5306000",
      sales_credit: "0",
      pay_in: "0",
      pay_out: "0",
      cash_diff: "-6037000",
      synced_at: "2026-09-10T04:30:00.000Z",
    });
  });
  test("open shift has null close_at", async () => {
    const row = mapShift({ ...RAW_SHIFT, closeDate: null, sessionStatus: "OPEN" }, await ctx());
    expect(row.close_at).toBeNull();
    expect(row.status).toBe("OPEN");
  });
  test("unknown point of sale leaves terminal and group null and falls back to OLAP register name", async () => {
    const row = mapShift(
      { ...RAW_SHIFT, pointOfSaleId: "99999999-9999-9999-9999-999999999999" },
      await ctx()
    );
    expect(row.terminal_id).toBeNull();
    expect(row.iiko_group_id).toBeNull();
    expect(row.iiko_group_name).toBeNull();
    expect(row.cash_register_name).toBe("21018 Kukcha kassa");
  });
  test("documented field names (pointOfSale instead of pointOfSaleId) fail loudly", async () => {
    const { pointOfSaleId, ...rest } = RAW_SHIFT;
    const c = await ctx();
    expect(() => mapShift({ ...rest, pointOfSale: pointOfSaleId }, c)).toThrow(
      'field "pointOfSaleId" missing'
    );
  });
});

describe("cashiers", () => {
  const S1 = "a401b573-533f-4a79-b593-a4af0aaf1c3a";
  const S2 = "4cd5f4cf-33c5-492c-b1b4-a1e454ee33d7";
  const rows = [
    { SessionID: S1, "Cashier.Id": "461d12fd-5a9a-453a-9eab-fd05ea547b27", Cashier: "Узбегим", "Cashier.Code": "6549530", CashRegisterName: "21001 - Andijon O'zbegim kassa", "UniqOrderId.OrdersCount": 100, DishDiscountSumInt: 10000000 },
    { SessionID: S1, "Cashier.Id": "461d12fd-5a9a-453a-9eab-fd05ea547b27", Cashier: "Узбегим", "Cashier.Code": "6549530", CashRegisterName: "21001 - Andijon O'zbegim kassa", "UniqOrderId.OrdersCount": 6, DishDiscountSumInt: 631000 },
    { SessionID: S2, "Cashier.Id": "d3df4a7f-7cac-4889-8522-f139b1a533ea", Cashier: "Baxrom", "Cashier.Code": "654940", CashRegisterName: "21004 Ekopark kassa", "UniqOrderId.OrdersCount": 2, DishDiscountSumInt: 133000 },
    { SessionID: S2, "Cashier.Id": null, Cashier: null, "Cashier.Code": null, CashRegisterName: "21004 Ekopark kassa", "UniqOrderId.OrdersCount": 1, DishDiscountSumInt: 5000 },
    { SessionID: "ffffffff-ffff-ffff-ffff-ffffffffffff", "Cashier.Id": "d3df4a7f-7cac-4889-8522-f139b1a533ea", Cashier: "Baxrom", "UniqOrderId.OrdersCount": 9, DishDiscountSumInt: 900 },
  ];

  test("aggregateCashiers sums split rows, drops foreign sessions, keeps orders without cashier", () => {
    const { cashiers, registerNames } = aggregateCashiers(rows, new Set([S1, S2]));
    expect(cashiers).toEqual([
      { shift_id: S1, cashier_id: "461d12fd-5a9a-453a-9eab-fd05ea547b27", cashier_name: "Узбегим", cashier_code: "6549530", orders_count: 106, revenue: "10631000" },
      { shift_id: S2, cashier_id: "d3df4a7f-7cac-4889-8522-f139b1a533ea", cashier_name: "Baxrom", cashier_code: "654940", orders_count: 2, revenue: "133000" },
      { shift_id: S2, cashier_id: "00000000-0000-0000-0000-000000000000", cashier_name: "—", cashier_code: null, orders_count: 1, revenue: "5000" },
    ]);
    expect(registerNames.get(S1)).toBe("21001 - Andijon O'zbegim kassa");
    expect(registerNames.has("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(false);
  });

  test("reconcile reports only shifts whose cashier revenue differs from pay_orders by more than 1", () => {
    const { cashiers } = aggregateCashiers(rows, new Set([S1, S2]));
    const shifts = [
      { id: S1, cash_reg_number: 2012, pay_orders: "10631000" },
      { id: S2, cash_reg_number: 22, pay_orders: "2174000" },
    ] as any;
    expect(reconcile(shifts, cashiers)).toEqual([
      { id: S2, cash_reg_number: 22, pay_orders: 2174000, revenue: 138000 },
    ]);
  });
});
