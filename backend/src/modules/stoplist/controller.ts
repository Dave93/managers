import { api_tokens } from "@backend/../drizzle/schema";
import { ctx } from "@backend/context";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import {
  extractBearerToken,
  isValidApiToken,
} from "../iiko_sync/auth";

// iiko's server API reports dateAdd in local Tashkent time without an offset.
// Normalize to an ISO string Postgres can cast to timestamptz; fall back to
// the sync moment when the value is missing or unparseable.
function normTs(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    return v.replace(" ", "T") + "+05:00";
  }
  return isNaN(new Date(v).getTime()) ? fallback : v;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WebhookItem = {
  terminal_id: number;
  terminal_name?: string | null;
  product_id: number;
  product_name?: string | null;
  balance?: number | null;
  date_add?: string | null;
  terminal_iiko_id?: string | null;
};

const itemT = t.Object({
  terminal_id: t.Integer(),
  terminal_name: t.Optional(t.Union([t.String(), t.Null()])),
  product_id: t.Integer(),
  product_name: t.Optional(t.Union([t.String(), t.Null()])),
  balance: t.Optional(t.Union([t.Number(), t.Null()])),
  date_add: t.Optional(t.Union([t.String(), t.Null()])),
  terminal_iiko_id: t.Optional(t.Union([t.String(), t.Null()])),
});

const TZ = "Asia/Tashkent";

const unwrapRows = (res: unknown): any[] =>
  Array.isArray(res) ? (res as any[]) : (((res as any)?.rows ?? []) as any[]);

type TerminalPair = { iiko: string; brand: string };

// The dashboard filter speaks in MANAGERS terminal uuids; stoplist rows are
// keyed by the iiko terminalGroup uuid. A two-brand location (Chopar + Les in
// one building) shares that uuid, so the resolution has to yield (uuid, brand)
// PAIRS - matching on the uuid alone would mix the other brand's stops in.
async function resolveTerminalPairs(
  drizzle: any,
  cacheController: any,
  terminalsParam: string | undefined,
  userTerminals: string[] | undefined
): Promise<{ pairs: TerminalPair[]; restrict: boolean }> {
  const wanted = terminalsParam
    ? terminalsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const cached = await cacheController.getCachedTerminals({});
  let list = cached.filter((tm: any) => (wanted ? wanted.includes(tm.id) : true));
  if (Array.isArray(userTerminals) && userTerminals.length > 0) {
    list = list.filter((tm: any) => userTerminals.includes(tm.id));
  }

  const orgRows = unwrapRows(
    await drizzle.execute(sql`
      SELECT id, CASE WHEN name ILIKE 'les%' THEN 'les' ELSE 'chopar' END AS brand
      FROM organization`)
  );
  const brandByOrg = new Map<string, string>(
    orgRows.map((r: any) => [String(r.id), String(r.brand)])
  );

  const pairs: TerminalPair[] = [];
  const seen = new Set<string>();
  for (const tm of list) {
    const key = tm.credentials?.find((c: any) => c.type === "iiko_id")?.key;
    const brand = brandByOrg.get(String(tm.organization_id));
    if (!key || !UUID_RE.test(key) || !brand) continue;
    const dedupe = `${key}|${brand}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    pairs.push({ iiko: key, brand });
  }

  return {
    pairs,
    restrict: !!wanted || (Array.isArray(userTerminals) && userTerminals.length > 0),
  };
}

// No filter at all for an unrestricted admin; a hard `false` when the request
// is restricted but nothing resolved, so an empty selection never leaks the
// whole network.
const pairFilter = (pairs: TerminalPair[], restrict: boolean) => {
  if (!restrict) return sql``;
  if (pairs.length === 0) return sql`AND false`;
  return sql`AND EXISTS (
    SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb)
      AS p(iiko uuid, brand text)
    WHERE p.iiko = si.terminal_iiko_id AND p.brand = si.brand)`;
};

// Registered on the app root (src/app.ts) with an explicit /api prefix and a
// widened export — same pattern and reasoning as iikoSyncController (the
// apiController .use() chain overflows TS2589; routes are HTTP-only, no Eden).
const stoplistControllerImpl = new Elysia({
  name: "@api/stoplist",
  prefix: "/api",
})
  .use(ctx)
  .post(
    "/stoplist/webhook",
    async ({ body, headers, set, cacheController, drizzle }) => {
      const token = extractBearerToken(headers.authorization);
      if (!token) {
        set.status = 401;
        return { message: "Unauthorized" };
      }
      const cached = await cacheController.getCachedApiTokens({});
      let valid = isValidApiToken(cached, token);
      if (!valid) {
        const rows = await drizzle
          .select({ token: api_tokens.token, active: api_tokens.active })
          .from(api_tokens)
          .where(and(eq(api_tokens.token, token), eq(api_tokens.active, true)))
          .execute();
        valid = rows.length > 0;
      }
      if (!valid) {
        set.status = 401;
        return { message: "Unauthorized" };
      }

      const brand = body.brand;
      const syncedAt = normTs(body.synced_at, new Date().toISOString());

      const prep = (items: WebhookItem[]) =>
        items.map((i) => ({
          terminal_id: i.terminal_id,
          terminal_name: i.terminal_name ?? null,
          product_id: i.product_id,
          product_name: i.product_name ?? null,
          balance: i.balance ?? null,
          date_add: i.date_add ? normTs(i.date_add, syncedAt) : null,
          started_at: i.date_add ? normTs(i.date_add, syncedAt) : syncedAt,
          terminal_iiko_id:
            i.terminal_iiko_id && UUID_RE.test(i.terminal_iiko_id)
              ? i.terminal_iiko_id
              : null,
        }));

      const stops = prep(body.stops);
      const releases = prep(body.releases);
      // Laravel always sends the full post-sync snapshot; treat a present-but-
      // empty array as authoritative ("nothing is stopped right now").
      const snapshot = body.snapshot !== undefined ? prep(body.snapshot) : null;

      const stopsJson = JSON.stringify(stops);
      const releasesJson = JSON.stringify(releases);

      const REC =
        sql.raw(`r(terminal_id int, terminal_name text, product_id int, product_name text,
                   balance double precision, date_add text, started_at text, terminal_iiko_id uuid)`);

      await drizzle.transaction(async (tx) => {
        // 1. Append-only events: the exact delta this sync observed.
        if (stops.length > 0) {
          await tx.execute(sql`
            INSERT INTO stoplist_events
              (event_at, brand, terminal_id, terminal_name, product_id, product_name, action, balance, date_add, terminal_iiko_id)
            SELECT (r.started_at)::timestamptz, ${brand}, r.terminal_id, r.terminal_name,
                   r.product_id, r.product_name, 'stop', r.balance, (r.date_add)::timestamptz, r.terminal_iiko_id
            FROM jsonb_to_recordset(${stopsJson}::jsonb) AS ${REC}`);
        }
        if (releases.length > 0) {
          await tx.execute(sql`
            INSERT INTO stoplist_events
              (event_at, brand, terminal_id, terminal_name, product_id, product_name, action, balance, terminal_iiko_id)
            SELECT ${syncedAt}::timestamptz, ${brand}, r.terminal_id, r.terminal_name,
                   r.product_id, r.product_name, 'release', r.balance, r.terminal_iiko_id
            FROM jsonb_to_recordset(${releasesJson}::jsonb) AS ${REC}`);

          // 2. Close open intervals for released positions.
          await tx.execute(sql`
            UPDATE stoplist_intervals si SET ended_at = ${syncedAt}::timestamptz
            WHERE si.brand = ${brand} AND si.ended_at IS NULL
              AND EXISTS (
                SELECT 1 FROM jsonb_to_recordset(${releasesJson}::jsonb) AS ${REC}
                WHERE r.terminal_id = si.terminal_id AND r.product_id = si.product_id)`);
        }

        // 3. Open intervals for new stops (partial unique index dedupes).
        if (stops.length > 0) {
          await tx.execute(sql`
            INSERT INTO stoplist_intervals
              (brand, terminal_id, terminal_name, product_id, product_name, started_at, last_balance, terminal_iiko_id)
            SELECT ${brand}, r.terminal_id, r.terminal_name, r.product_id, r.product_name,
                   (r.started_at)::timestamptz, r.balance, r.terminal_iiko_id
            FROM jsonb_to_recordset(${stopsJson}::jsonb) AS ${REC}
            ON CONFLICT (brand, terminal_id, product_id) WHERE ended_at IS NULL DO NOTHING`);
        }

        // 4. Snapshot reconciliation — self-seeding on first sync and
        //    self-healing if some syncs never reached us. Also backfills
        //    terminal_iiko_id on open intervals created before the column existed.
        if (snapshot !== null) {
          const snapshotJson = JSON.stringify(snapshot);
          await tx.execute(sql`
            UPDATE stoplist_intervals si SET ended_at = ${syncedAt}::timestamptz
            WHERE si.brand = ${brand} AND si.ended_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_to_recordset(${snapshotJson}::jsonb) AS ${REC}
                WHERE r.terminal_id = si.terminal_id AND r.product_id = si.product_id)`);
          await tx.execute(sql`
            INSERT INTO stoplist_intervals
              (brand, terminal_id, terminal_name, product_id, product_name, started_at, last_balance, terminal_iiko_id)
            SELECT ${brand}, r.terminal_id, r.terminal_name, r.product_id, r.product_name,
                   (r.started_at)::timestamptz, r.balance, r.terminal_iiko_id
            FROM jsonb_to_recordset(${snapshotJson}::jsonb) AS ${REC}
            ON CONFLICT (brand, terminal_id, product_id) WHERE ended_at IS NULL DO NOTHING`);
          await tx.execute(sql`
            UPDATE stoplist_intervals si SET terminal_iiko_id = r.terminal_iiko_id
            FROM jsonb_to_recordset(${snapshotJson}::jsonb) AS ${REC}
            WHERE si.brand = ${brand} AND si.ended_at IS NULL AND si.terminal_iiko_id IS NULL
              AND r.terminal_iiko_id IS NOT NULL
              AND r.terminal_id = si.terminal_id AND r.product_id = si.product_id`);
        }
      });

      return {
        ok: true,
        brand,
        stops: stops.length,
        releases: releases.length,
        snapshot: snapshot === null ? null : snapshot.length,
      };
    },
    {
      body: t.Object({
        brand: t.Union([t.Literal("chopar"), t.Literal("les")]),
        synced_at: t.String(),
        stops: t.Array(itemT),
        releases: t.Array(itemT),
        snapshot: t.Optional(t.Array(itemT)),
      }),
    }
  )
  // Manager-facing analytics for one of THEIR terminals (session + permission).
  // terminal_id here is the MANAGERS terminals.id uuid (as used by
  // users_terminals/my_terminals); it is resolved to the iiko terminalGroup
  // uuid via credentials(model='terminals', type='iiko_id').
  .get(
    "/stoplist/manager",
    async ({ query, set, drizzle }) => {
      const terminalId = query.terminal_id;
      const days = Math.min(Math.max(parseInt(query.days || "30", 10) || 30, 1), 365);
      if (!terminalId || !UUID_RE.test(terminalId)) {
        set.status = 422;
        return { message: "terminal_id (uuid) is required" };
      }

      // Both brands of one physical location share the same iiko terminalGroup
      // uuid, so the iiko id alone is ambiguous — the managers terminal's
      // organization decides which brand's stop rows belong to it.
      const credRes: any = await drizzle.execute(sql`
        SELECT c.key,
               CASE WHEN o.name ILIKE 'les%' THEN 'les' ELSE 'chopar' END AS brand
        FROM credentials c
        JOIN terminals t ON t.id = c.model_id::uuid
        JOIN organization o ON o.id = t.organization_id
        WHERE c.model = 'terminals' AND c.type = 'iiko_id' AND c.model_id = ${terminalId}
        LIMIT 1`);
      const rowsArr: { key: string; brand: string }[] = Array.isArray(credRes)
        ? credRes
        : (credRes?.rows ?? []);
      if (rowsArr.length === 0 || !UUID_RE.test(rowsArr[0].key)) {
        return { current: [], chronic: [], daily: [], iiko_id: null };
      }
      const iikoId = rowsArr[0].key;
      const termBrand = rowsArr[0].brand;

      const unwrap = <T,>(res: unknown): T[] =>
        Array.isArray(res) ? (res as T[]) : (((res as any)?.rows ?? []) as T[]);

      const current = unwrap<Record<string, unknown>>(
        await drizzle.execute(sql`
          SELECT brand, product_id, product_name, started_at, last_balance,
                 EXTRACT(epoch FROM (now() - started_at))::bigint AS seconds_stopped
          FROM stoplist_intervals
          WHERE terminal_iiko_id = ${iikoId} AND brand = ${termBrand} AND ended_at IS NULL
          ORDER BY started_at ASC`)
      );

      const chronic = unwrap<Record<string, unknown>>(
        await drizzle.execute(sql`
          SELECT product_id, product_name,
                 count(*)::int AS times_stopped,
                 EXTRACT(epoch FROM sum(COALESCE(ended_at, now()) - GREATEST(started_at, now() - make_interval(days => ${days}))))::bigint AS seconds_stopped
          FROM stoplist_intervals
          WHERE terminal_iiko_id = ${iikoId} AND brand = ${termBrand}
            AND COALESCE(ended_at, now()) >= now() - make_interval(days => ${days})
          GROUP BY product_id, product_name
          ORDER BY seconds_stopped DESC
          LIMIT 20`)
      );

      const daily = unwrap<Record<string, unknown>>(
        await drizzle.execute(sql`
          SELECT date_trunc('day', event_at)::date AS day,
                 count(*) FILTER (WHERE action = 'stop')::int AS stops,
                 count(*) FILTER (WHERE action = 'release')::int AS releases
          FROM stoplist_events
          WHERE terminal_iiko_id = ${iikoId} AND brand = ${termBrand}
            AND event_at >= now() - make_interval(days => ${days})
          GROUP BY 1 ORDER BY 1`)
      );

      return { current, chronic, daily, iiko_id: iikoId };
    },
    {
      permission: "stoplist.list",
      query: t.Object({
        terminal_id: t.String(),
        days: t.Optional(t.String()),
      }),
    } as any
  )
  // ---- Dashboard widget: "what went on stop, day by day" --------------------
  // Reads stoplist_intervals (one row per stop occurrence, ended_at NULL =
  // still stopped) rather than stoplist_events, so every row already carries
  // its duration and the pre-2026-08-13 backfill noise falls outside any real
  // date range the dashboard asks for.
  .get(
    "/stoplist/by-day",
    async (c: any) => {
      const { query, set, drizzle, cacheController } = c;
      const userTerminals = c.terminals as string[] | undefined;
      const { pairs, restrict } = await resolveTerminalPairs(
        drizzle,
        cacheController,
        query.terminals,
        userTerminals
      );
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT to_char((si.started_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
                 count(*)::int AS stops,
                 count(DISTINCT si.product_id)::int AS products,
                 count(DISTINCT (si.brand || si.terminal_id::text))::int AS terminals,
                 count(*) FILTER (WHERE si.ended_at IS NULL)::int AS still_open,
                 count(*) FILTER (WHERE si.brand = 'les')::int AS les,
                 count(*) FILTER (WHERE si.brand = 'chopar')::int AS chopar
          FROM stoplist_intervals si
          WHERE (si.started_at AT TIME ZONE ${TZ})::date
                BETWEEN (${query.startDate}::timestamptz AT TIME ZONE ${TZ})::date
                    AND (${query.endDate}::timestamptz AT TIME ZONE ${TZ})::date
          ${pairFilter(pairs, restrict)}
          GROUP BY 1 ORDER BY 1 DESC`)
      );
      return {
        days: rows.map((r: any) => ({
          day: typeof r.day === "string" ? r.day : new Date(r.day).toISOString().slice(0, 10),
          stops: Number(r.stops) || 0,
          products: Number(r.products) || 0,
          terminals: Number(r.terminals) || 0,
          still_open: Number(r.still_open) || 0,
          les: Number(r.les) || 0,
          chopar: Number(r.chopar) || 0,
        })),
      };
    },
    {
      permission: "charts.list",
      query: t.Object({
        startDate: t.String(),
        endDate: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  )
  // Positions stopped on one calendar day (Tashkent), newest first.
  .get(
    "/stoplist/by-day/items",
    async (c: any) => {
      const { query, set, drizzle, cacheController } = c;
      const userTerminals = c.terminals as string[] | undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.day)) {
        set.status = 422;
        return { message: "day (YYYY-MM-DD) is required" };
      }
      const { pairs, restrict } = await resolveTerminalPairs(
        drizzle,
        cacheController,
        query.terminals,
        userTerminals
      );
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT si.brand, si.terminal_id, si.terminal_name, si.product_id, si.product_name,
                 si.started_at, si.ended_at, si.last_balance,
                 EXTRACT(epoch FROM (COALESCE(si.ended_at, now()) - si.started_at))::bigint AS seconds_stopped
          FROM stoplist_intervals si
          WHERE (si.started_at AT TIME ZONE ${TZ})::date = ${query.day}::date
          ${pairFilter(pairs, restrict)}
          ORDER BY si.started_at DESC
          LIMIT 3000`)
      );
      return {
        day: query.day,
        items: rows.map((r: any) => ({
          brand: String(r.brand),
          terminal_id: Number(r.terminal_id),
          terminal_name: r.terminal_name ?? null,
          product_id: Number(r.product_id),
          product_name: r.product_name ?? null,
          started_at: r.started_at,
          ended_at: r.ended_at ?? null,
          last_balance: r.last_balance == null ? null : Number(r.last_balance),
          seconds_stopped: Number(r.seconds_stopped) || 0,
        })),
      };
    },
    {
      permission: "charts.list",
      query: t.Object({
        day: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  )
  // ---- Admin section: /admin/stoplist ---------------------------------------
  // Paginated stop intervals that were ACTIVE at any moment of the requested
  // period (overlap, not "started in"), so a position stopped weeks ago and
  // still open is visible in today's view. Every user-supplied value is bound
  // as a parameter — the previous incarnation of this page was removed because
  // its DuckDB backend concatenated filters into SQL.
  .get(
    "/stoplist/list",
    async (c: any) => {
      const { query, set, drizzle, cacheController } = c;
      const userTerminals = c.terminals as string[] | undefined;

      const start = new Date(query.startDate);
      const end = new Date(query.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        set.status = 422;
        return { message: "startDate/endDate (ISO) are required" };
      }
      const limit = Math.min(Math.max(parseInt(query.limit || "20", 10) || 20, 1), 200);
      const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);
      const brand =
        query.brand === "les" || query.brand === "chopar" ? query.brand : null;
      const status =
        query.status === "open" || query.status === "closed" ? query.status : "all";
      const search = String(query.search || "").trim().slice(0, 100);

      const { pairs, restrict } = await resolveTerminalPairs(
        drizzle,
        cacheController,
        query.terminals,
        userTerminals
      );

      const startIso = start.toISOString();
      const endIso = end.toISOString();
      const where = sql`
        WHERE si.started_at <= ${endIso}::timestamptz
          AND COALESCE(si.ended_at, now()) >= ${startIso}::timestamptz
          ${brand ? sql`AND si.brand = ${brand}` : sql``}
          ${
            status === "open"
              ? sql`AND si.ended_at IS NULL`
              : status === "closed"
                ? sql`AND si.ended_at IS NOT NULL`
                : sql``
          }
          ${
            search
              ? sql`AND (si.product_name ILIKE ${"%" + search + "%"}
                     OR si.terminal_name ILIKE ${"%" + search + "%"})`
              : sql``
          }
          ${pairFilter(pairs, restrict)}`;

      const [summary] = unwrapRows(
        await drizzle.execute(sql`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE si.ended_at IS NULL)::int AS open,
                 count(*) FILTER (WHERE si.ended_at IS NULL
                                    AND now() - si.started_at >= interval '1 day')::int AS open_over_day,
                 count(DISTINCT si.product_id)::int AS products,
                 COALESCE(sum(EXTRACT(epoch FROM (
                   LEAST(COALESCE(si.ended_at, now()), ${endIso}::timestamptz)
                   - GREATEST(si.started_at, ${startIso}::timestamptz)))), 0)::bigint AS seconds_in_period
          FROM stoplist_intervals si ${where}`)
      );

      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT si.id, si.brand, si.terminal_id, si.terminal_name,
                 si.product_id, si.product_name,
                 si.started_at, si.ended_at, si.last_balance,
                 EXTRACT(epoch FROM (COALESCE(si.ended_at, now()) - si.started_at))::bigint AS seconds_stopped
          FROM stoplist_intervals si ${where}
          ORDER BY (si.ended_at IS NULL) DESC, si.started_at DESC
          LIMIT ${limit} OFFSET ${offset}`)
      );

      return {
        total: Number(summary?.total) || 0,
        summary: {
          open: Number(summary?.open) || 0,
          open_over_day: Number(summary?.open_over_day) || 0,
          products: Number(summary?.products) || 0,
          hours_in_period: Math.round((Number(summary?.seconds_in_period) || 0) / 3600),
        },
        data: rows.map((r: any) => ({
          id: String(r.id),
          brand: String(r.brand),
          terminal_id: Number(r.terminal_id),
          terminal_name: r.terminal_name ?? null,
          product_id: Number(r.product_id),
          product_name: r.product_name ?? null,
          started_at: r.started_at,
          ended_at: r.ended_at ?? null,
          last_balance: r.last_balance == null ? null : Number(r.last_balance),
          seconds_stopped: Number(r.seconds_stopped) || 0,
        })),
      };
    },
    {
      permission: "stoplist.list",
      query: t.Object({
        startDate: t.String(),
        endDate: t.String(),
        terminals: t.Optional(t.String()),
        brand: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    } as any
  );

// Widened export: keeps the app root .use() chain from overflowing TS
// instantiation depth; routes are HTTP-only (no Eden consumers).
export const stoplistController = stoplistControllerImpl as unknown as Elysia;
