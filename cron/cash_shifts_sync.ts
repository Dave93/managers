/**
 * Sync iiko cash shifts and per-shift cashiers into managers.
 *
 * Usage (from /home/davr/managers/cron, env from ./.env):
 *   ./cash_shifts_sync                                  # today-3 .. today (Tashkent)
 *   ./cash_shifts_sync --from 2026-06-12 --to 2026-09-10
 *
 * Spec: docs/superpowers/specs/2026-09-10-cash-shifts-widget-design.md
 */
import { drizzleDb } from "@backend/lib/db";
import { cash_shifts, cash_shift_cashiers } from "backend/drizzle/schema";
import { inArray, sql } from "drizzle-orm";
import { IikoResto } from "./src/modules/cash_shifts/iiko";
import {
  addDays,
  aggregateCashiers,
  chunk,
  dateChunks,
  mapShift,
  parseEmployeesXml,
  parseGroupsXml,
  reconcile,
  tashkentToday,
  type CashierRow,
  type ShiftRow,
} from "./src/modules/cash_shifts/parse";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv: string[]): { from: string; to: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const today = tashkentToday();
  const from = get("--from") ?? addDays(today, -3);
  const to = get("--to") ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error(`bad --from/--to: ${from} ${to}`);
  return { from, to };
}

async function loadTerminalByGroup(): Promise<Map<string, string>> {
  const res: any = await drizzleDb.execute(sql`
    SELECT key, model_id FROM credentials WHERE model = 'terminals' AND type = 'iiko_id'`);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? [];
  return new Map(rows.map((r) => [String(r.key), String(r.model_id)]));
}

async function fetchShifts(iiko: IikoResto, from: string, to: string): Promise<any[]> {
  const res = await iiko.request("GET", "/v2/cashshifts/list", {
    openDateFrom: from,
    openDateTo: to,
    status: "ANY",
  });
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`cashshifts/list: expected array, got ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// SALES is inclusive at both ends of DateRange (TRANSACTIONS is not).
async function fetchCashierOlap(iiko: IikoResto, from: string, to: string): Promise<any[]> {
  const res = await iiko.request("POST", "/v2/reports/olap", {}, {
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["SessionID", "Cashier.Id", "Cashier", "Cashier.Code", "CashRegisterName"],
    aggregateFields: ["UniqOrderId.OrdersCount", "DishDiscountSumInt"],
    filters: {
      "OpenDate.Typed": { filterType: "DateRange", periodType: "CUSTOM", from, to, includeLow: true, includeHigh: true },
      OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
      DeletedWithWriteoff: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
    },
  });
  const data: any = await res.json();
  if (!Array.isArray(data?.data)) throw new Error(`olap: unexpected shape ${JSON.stringify(data).slice(0, 200)}`);
  return data.data;
}

const UPDATE_COLS = [
  "terminal_id", "iiko_group_id", "iiko_group_name", "point_of_sale_id", "cash_reg_number",
  "cash_register_name", "session_number", "open_at", "close_at", "business_date", "status",
  "responsible_user_id", "responsible_user_name", "manager_id", "manager_name", "pay_orders",
  "sales_cash", "sales_card", "sales_credit", "pay_in", "pay_out", "cash_diff", "synced_at",
] as const;

async function saveChunk(rows: ShiftRow[], cashiers: CashierRow[]): Promise<void> {
  if (rows.length === 0) return;
  const set = Object.fromEntries(UPDATE_COLS.map((c) => [c, sql.raw(`excluded.${c}`)]));
  await drizzleDb.transaction(async (tx) => {
    for (const part of chunk(rows, 500)) {
      await tx.insert(cash_shifts).values(part).onConflictDoUpdate({ target: cash_shifts.id, set });
    }
    await tx
      .delete(cash_shift_cashiers)
      .where(inArray(cash_shift_cashiers.shift_id, rows.map((r) => r.id)));
    for (const part of chunk(cashiers, 1000)) {
      await tx.insert(cash_shift_cashiers).values(part);
    }
  });
}

async function main(): Promise<number> {
  const { from, to } = parseArgs(process.argv);
  const started = Date.now();
  console.log(`[cash_shifts] start ${new Date().toISOString()} window ${from}..${to}`);
  const iiko = new IikoResto();
  try {
    const [groupsXml, employeesXml] = [
      await (await iiko.request("GET", "/corporation/groups")).text(),
      await (await iiko.request("GET", "/employees")).text(),
    ];
    const pos = await parseGroupsXml(groupsXml);
    const names = await parseEmployeesXml(employeesXml);
    const terminalByGroup = await loadTerminalByGroup();
    console.log(`[cash_shifts] dictionaries: pos=${pos.size} employees=${names.size} terminals=${terminalByGroup.size}`);

    const totals = { shifts: 0, cashiers: 0, mismatches: 0, unmapped: 0 };
    for (const part of dateChunks(from, to)) {
      const raw = await fetchShifts(iiko, part.from, part.to);
      const ids = new Set<string>(raw.map((r) => r.id));
      // Night-shift orders can land in the neighbouring accounting day.
      const olap = await fetchCashierOlap(iiko, addDays(part.from, -1), addDays(part.to, 1));
      const { cashiers, registerNames } = aggregateCashiers(olap, ids);
      const syncedAt = new Date().toISOString();
      const rows = raw.map((r) => mapShift(r, { pos, terminalByGroup, names, registerNames, syncedAt }));
      await saveChunk(rows, cashiers);

      const mismatches = reconcile(rows, cashiers);
      for (const m of mismatches) {
        console.warn(`[cash_shifts] mismatch shift=${m.id} reg=${m.cash_reg_number} pay_orders=${m.pay_orders} cashiers=${m.revenue}`);
      }
      const unmapped = rows.filter((r) => !r.terminal_id);
      for (const r of unmapped) {
        console.warn(`[cash_shifts] unmapped pos=${r.point_of_sale_id} group=${r.iiko_group_name ?? "?"} reg=${r.cash_reg_number}`);
      }
      totals.shifts += rows.length;
      totals.cashiers += cashiers.length;
      totals.mismatches += mismatches.length;
      totals.unmapped += unmapped.length;
      console.log(`[cash_shifts] ${part.from}..${part.to}: shifts=${rows.length} cashiers=${cashiers.length}`);
    }
    console.log(
      `[cash_shifts] done ${from}..${to} shifts=${totals.shifts} cashiers=${totals.cashiers} mismatches=${totals.mismatches} unmapped=${totals.unmapped} in ${Math.round((Date.now() - started) / 1000)}s`
    );
    return 0;
  } catch (e) {
    console.error(`[cash_shifts] FAILED: ${(e as Error).stack ?? e}`);
    return 1;
  } finally {
    await iiko.logout();
  }
}

main().then((code) => process.exit(code));
