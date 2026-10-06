// Клиент iiko resto API для сверки — ТОЛЬКО ЧТЕНИЕ (spec 2026-10-06, §3).
// Методы: storeOperations (документы с комментарием), OLAP TRANSACTIONS
// (корректировки), balance/stores (учёт). Токен занимает лицензионный слот
// iiko, поэтому один токен на вызов withIikoClient и logout в finally.
import { createHash } from "node:crypto";
import {
  inventoryDocs,
  nextDay,
  parseOlapCorrections,
  parseStoreOperations,
  toIikoDate,
  type BookRow,
  type Correction,
  type IikoDoc,
} from "./pure";

export interface IikoClient {
  /** Проведённые документы инвентаризации за день (YYYY-MM-DD), все склады. */
  inventoryDocs(date: string): Promise<IikoDoc[]>;
  /** Корректировки инвентаризаций за [period, period + 1 день), все склады. */
  corrections(period: string): Promise<Correction[]>;
  /** Учётный остаток склада на момент at (YYYY-MM-DDTHH:mm:ss, местное время iiko). */
  balance(storeId: string, at: string): Promise<BookRow[]>;
}

export type IikoClientOptions = {
  base?: string;
  login?: string;
  password?: string;
  fetch?: typeof fetch;
  retries?: number;
};

export class IikoError extends Error {}

const DEFAULT_BASE = "https://les-ailes-co-co.iiko.it/resto/api";
const TIMEOUT_MS = 120_000;

/** iiko принимает sha1 пароля; в .env бывает и готовый хэш. */
export function passwordHash(p: string): string {
  return /^[0-9a-f]{40}$/i.test(p) ? p.toLowerCase() : createHash("sha1").update(p).digest("hex");
}

export async function withIikoClient<T>(fn: (c: IikoClient) => Promise<T>, opts: IikoClientOptions = {}): Promise<T> {
  const base = opts.base ?? DEFAULT_BASE;
  const f = opts.fetch ?? fetch;
  const login = opts.login ?? process.env.IIKO_LOGIN;
  const password = opts.password ?? process.env.IIKO_PASSWORD;
  const retries = opts.retries ?? 2;
  if (!login || !password) throw new IikoError("IIKO_LOGIN / IIKO_PASSWORD are not set");

  async function request(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        if (attempt >= retries) throw new IikoError(`iiko: ${(e as Error).message}`);
        continue;
      }
      if (res.status >= 500 && attempt < retries) continue;
      if (!res.ok) throw new IikoError(`iiko ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res;
    }
  }

  const auth = await request(`${base}/auth?login=${encodeURIComponent(login)}&pass=${passwordHash(password)}`);
  const key = (await auth.text()).trim();

  const client: IikoClient = {
    async inventoryDocs(date) {
      const d = toIikoDate(date);
      const res = await request(
        `${base}/reports/storeOperations?key=${key}&dateFrom=${d}&dateTo=${d}&documentTypes=INCOMING_INVENTORY&productDetalization=false`
      );
      return inventoryDocs(parseStoreOperations(await res.text()));
    },
    async corrections(period) {
      const body = {
        reportType: "TRANSACTIONS",
        buildSummary: "false",
        groupByRowFields: ["Account.Id", "Document", "DateTime.Typed", "Product.Id", "Product.Name"],
        aggregateFields: ["Amount", "Sum.ResignedSum"],
        filters: {
          "DateTime.DateTyped": {
            filterType: "DateRange",
            periodType: "CUSTOM",
            from: period,
            to: nextDay(period),
            includeLow: true,
            includeHigh: false,
          },
          TransactionType: { filterType: "IncludeValues", values: ["INVENTORY_CORRECTION"] },
        },
      };
      const res = await request(`${base}/v2/reports/olap?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { data?: Record<string, unknown>[] };
      return parseOlapCorrections(j.data ?? []);
    },
    async balance(storeId, at) {
      const res = await request(
        `${base}/v2/reports/balance/stores?key=${key}&timestamp=${encodeURIComponent(at)}&store=${storeId}`
      );
      const j = (await res.json()) as { product: string; amount: number; sum: number }[];
      return j.map((x) => ({ product_id: x.product, amount: Number(x.amount), sum: Number(x.sum) }));
    },
  };

  try {
    return await fn(client);
  } finally {
    try {
      await f(`${base}/logout?key=${key}`);
    } catch {
      // слот освободится по таймауту токена iiko
    }
  }
}
