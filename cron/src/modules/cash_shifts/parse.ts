// Pure helpers for cron/cash_shifts_sync.ts. No network, no DB: everything
// here is covered by parse.test.ts.
import { parseStringPromise } from "xml2js";

export type PosInfo = { groupId: string; groupName: string; posName: string };

export type ShiftRow = {
  id: string;
  terminal_id: string | null;
  iiko_group_id: string | null;
  iiko_group_name: string | null;
  point_of_sale_id: string;
  cash_reg_number: number;
  cash_register_name: string | null;
  session_number: number;
  open_at: string;
  close_at: string | null;
  business_date: string;
  status: string;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  pay_orders: string;
  sales_cash: string;
  sales_card: string;
  sales_credit: string;
  pay_in: string;
  pay_out: string;
  cash_diff: string;
  synced_at: string;
};

export type CashierRow = {
  shift_id: string;
  cashier_id: string;
  cashier_name: string;
  cashier_code: string | null;
  orders_count: number;
  revenue: string;
};

export type MapContext = {
  pos: Map<string, PosInfo>;
  terminalByGroup: Map<string, string>;
  names: Map<string, string>;
  registerNames: Map<string, string>;
  syncedAt: string;
};

const DAY_MS = 86_400_000;
const NAIVE_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// iiko reports shift times as naive Tashkent wall-clock time. Postgres needs
// the offset to store the right instant in timestamptz.
export function iikoTsToIso(v: string): string {
  const s = String(v).trim().replace(" ", "T");
  if (!NAIVE_TS.test(s)) throw new Error(`unexpected iiko timestamp: ${v}`);
  return `${s}+05:00`;
}

export function businessDateOf(openDate: string): string {
  return iikoTsToIso(openDate).slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function dateChunks(from: string, to: string, size = 7): { from: string; to: string }[] {
  if (from > to) throw new Error(`dateChunks: from ${from} is after to ${to}`);
  const out: { from: string; to: string }[] = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, size - 1) < to ? addDays(cur, size - 1) : to;
    out.push({ from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

// Uzbekistan has no DST, a fixed +5h is exact.
export function tashkentToday(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// corporation/groups: groupDto → pointOfSaleDtoes → pointOfSaleDto. An empty
// <pointOfSaleDtoes/> parses to [""], which yields no points of sale.
export async function parseGroupsXml(xml: string): Promise<Map<string, PosInfo>> {
  const parsed = await parseStringPromise(xml);
  const map = new Map<string, PosInfo>();
  for (const g of parsed?.groupDtoes?.groupDto ?? []) {
    const groupId = g.id?.[0];
    if (!groupId) continue;
    const groupName = g.name?.[0] ?? "";
    for (const p of g.pointOfSaleDtoes?.[0]?.pointOfSaleDto ?? []) {
      const id = p.id?.[0];
      if (id) map.set(id, { groupId, groupName, posName: p.name?.[0] ?? "" });
    }
  }
  return map;
}

export async function parseEmployeesXml(xml: string): Promise<Map<string, string>> {
  const parsed = await parseStringPromise(xml);
  const map = new Map<string, string>();
  for (const e of parsed?.employees?.employee ?? []) {
    const id = e.id?.[0];
    if (id) map.set(id, e.name?.[0] ?? "");
  }
  return map;
}

// The live API uses responsibleUserId/pointOfSaleId while the docs say
// responsibleUser/pointOfSale. If iiko ever switches, stop the run instead of
// writing nulls.
const REQUIRED = ["id", "openDate", "pointOfSaleId", "cashRegNumber", "sessionNumber", "sessionStatus"] as const;

const money = (v: unknown) => String(Number(v ?? 0) || 0);

export function mapShift(raw: any, c: MapContext): ShiftRow {
  for (const k of REQUIRED) {
    const v = raw?.[k];
    if (v === undefined || v === null || v === "") {
      throw new Error(`cashshifts/list: field "${k}" missing in shift ${raw?.id ?? "?"}, API shape changed?`);
    }
  }
  if (!("responsibleUserId" in (raw ?? {}))) throw new Error(`cashshifts/list: field "responsibleUserId" missing in shift ${raw?.id ?? "?"}, API shape changed?`);
  const pos = c.pos.get(raw.pointOfSaleId);
  const groupId = pos?.groupId ?? null;
  const nameOf = (id: string | null | undefined) => (id ? c.names.get(id) ?? null : null);
  return {
    id: raw.id,
    terminal_id: groupId ? c.terminalByGroup.get(groupId) ?? null : null,
    iiko_group_id: groupId,
    iiko_group_name: pos?.groupName ?? null,
    point_of_sale_id: raw.pointOfSaleId,
    cash_reg_number: Number(raw.cashRegNumber),
    cash_register_name: c.registerNames.get(raw.id) ?? pos?.posName ?? null,
    session_number: Number(raw.sessionNumber),
    open_at: iikoTsToIso(raw.openDate),
    close_at: raw.closeDate ? iikoTsToIso(raw.closeDate) : null,
    business_date: businessDateOf(raw.openDate),
    status: String(raw.sessionStatus),
    responsible_user_id: raw.responsibleUserId ?? null,
    responsible_user_name: nameOf(raw.responsibleUserId),
    manager_id: raw.managerId ?? null,
    manager_name: nameOf(raw.managerId),
    pay_orders: money(raw.payOrders),
    sales_cash: money(raw.salesCash),
    sales_card: money(raw.salesCard),
    sales_credit: money(raw.salesCredit),
    pay_in: money(raw.payIn),
    pay_out: money(raw.payOut),
    cash_diff: money(raw.cashDiff),
    synced_at: c.syncedAt,
  };
}

// OLAP SALES rows grouped by SessionID × Cashier.Id (× name/code/register,
// which can split one cashier into several rows). Orders without a cashier
// keep a zero uuid so the per-shift sum still reconciles with payOrders.
export function aggregateCashiers(
  rows: any[],
  shiftIds: Set<string>
): { cashiers: CashierRow[]; registerNames: Map<string, string> } {
  const acc = new Map<string, Omit<CashierRow, "revenue"> & { revenue: number }>();
  const registerNames = new Map<string, string>();
  for (const r of rows) {
    const sid = r["SessionID"];
    if (!sid || !shiftIds.has(sid)) continue;
    const cid = r["Cashier.Id"] || ZERO_UUID;
    const key = `${sid}|${cid}`;
    const cur = acc.get(key) ?? {
      shift_id: sid,
      cashier_id: cid,
      cashier_name: r["Cashier"] || "—",
      cashier_code: r["Cashier.Code"] || null,
      orders_count: 0,
      revenue: 0,
    };
    cur.orders_count += Number(r["UniqOrderId.OrdersCount"]) || 0;
    cur.revenue += Number(r["DishDiscountSumInt"]) || 0;
    acc.set(key, cur);
    if (r["CashRegisterName"] && !registerNames.has(sid)) registerNames.set(sid, r["CashRegisterName"]);
  }
  return {
    cashiers: [...acc.values()].map((c) => ({ ...c, revenue: String(c.revenue) })),
    registerNames,
  };
}

export function reconcile(
  shifts: Pick<ShiftRow, "id" | "cash_reg_number" | "pay_orders">[],
  cashiers: CashierRow[],
  tolerance = 1
): { id: string; cash_reg_number: number; pay_orders: number; revenue: number }[] {
  const sum = new Map<string, number>();
  for (const c of cashiers) sum.set(c.shift_id, (sum.get(c.shift_id) ?? 0) + Number(c.revenue));
  return shifts
    .filter((s) => Math.abs(Number(s.pay_orders) - (sum.get(s.id) ?? 0)) > tolerance)
    .map((s) => ({
      id: s.id,
      cash_reg_number: s.cash_reg_number,
      pay_orders: Number(s.pay_orders),
      revenue: sum.get(s.id) ?? 0,
    }));
}
