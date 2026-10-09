import Elysia, { t } from "elysia";
import {
  credentials,
  hangingOrderActions,
  hangingOrders,
  organization,
} from "@backend/../drizzle/schema";
import {
  InferSelectModel,
  SQLWrapper,
  and,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  lte,
  isNull,
  notInArray,
  or,
  sql,
  desc,
  asc,
} from "drizzle-orm";
import { PgColumn, SelectedFields } from "drizzle-orm/pg-core";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { createInsertSchema } from "drizzle-typebox";
import { ctx } from "@backend/context";
import type { DrizzleDB } from "@backend/lib/db";
import dayjs from "dayjs";


// ---------------------------------------------------------------------------
// Ре-синк статусов из iiko.
//
// Ночной бот (отдельный репозиторий iikohangingorders, root crontab 9:01/9:02)
// делает разовый снимок вчерашних незакрытых доставок, а при повторном запуске
// существующие строки пропускает, а не обновляет. Поэтому заказ, закрытый
// филиалом уже ПОСЛЕ снимка, навсегда остаётся здесь со статусом Waiting/OnWay.
//
// Этот endpoint перечитывает iiko по открытым строкам за последние `days` дней
// и обновляет order_status / problem / amount. Ручные поля status и comment не
// трогаем — их заполняют менеджеры.
// ---------------------------------------------------------------------------

const IIKO_URL = "https://api-ru.iiko.services/api/1/";

// iikoServer — бэк-офис, на нём построен iikoChain. Источник правды о закрытии.
const IIKO_SERVER = "https://les-ailes-co-co.iiko.it/resto/api";

// Глубже не пускаем ни сверку, ни отмену: хвост старше полугода не нужен
// (так решили 2026-10-09), а на длинном окне iikoCloud за частые обращения
// блокирует логин (Locked). Принимает ли касса отмену старых заказов, не
// проверено — на этот случай массовая отмена останавливается после пяти
// отказов подряд.
const MAX_WINDOW_MONTHS = 6;
// Пауза между запросами в iikoCloud по дням — та же причина.
const CLOUD_PAUSE_MS = 400;

// Резолвим организацию по organization.code, а не по захардкоженному uuid:
// id организаций на разных стендах отличаются. В БД коды — 'chopar' и 'les'.
const BRAND_ORG_CODE: Record<string, string> = {
  chopar: "chopar",
  les_ailes: "les",
};

// В отличие от бота запрашиваем И финальные статусы — ровно они и нужны, чтобы
// погасить строку, которую филиал закрыл после утреннего снимка.
const ALL_DELIVERY_STATUSES = [
  "Unconfirmed",
  "WaitCooking",
  "ReadyForCooking",
  "CookingStarted",
  "CookingCompleted",
  "Waiting",
  "OnWay",
  "Delivered",
  "Closed",
  "Cancelled",
];

const FINAL_STATUSES = ["Closed", "Cancelled"];

// iiko лимитирует частоту; повторяем только на 429, как в боте.
async function fetchIikoWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  let delay = 1000;
  let res = await fetch(url, init);
  for (let attempt = 1; attempt < 3 && res.status === 429; attempt++) {
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
    res = await fetch(url, init);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Действия над заказом в iiko: закрыть и отменить. Только для admin
// (право hanging_orders.iiko_actions).
//
// Команды iikoCloud асинхронны: облако отдаёт correlationId, а выполняет
// их iikoFront на точке. Результат ждём через commands/status.
//
// Перед каждым действием перепроверяем iikoServer: облако бывает не в курсе
// закрытия, сделанного в бэк-офисе (08.10 чеки Les Ailes полдня числились
// Waiting, будучи закрытыми и оплаченными). Отменить такой заказ — сторно
// оплаченного заказа, поэтому отмену в этом случае запрещаем.
// ---------------------------------------------------------------------------

const ACTION_PERMISSION = "hanging_orders.iiko_actions";
const COMMAND_TIMEOUT_MS = 45_000;
const COMMAND_POLL_MS = 1_500;

type CloudSession = { token: string; iikoOrgId: string };

/** Токен и id организации iikoCloud для бренда; бросает с понятным текстом. */
async function cloudSession(drizzle: DrizzleDB, brand: string): Promise<CloudSession> {
  const orgCode = BRAND_ORG_CODE[brand];
  if (!orgCode) throw new Error(`Неизвестный бренд: ${brand}`);

  const org = await drizzle
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.code, orgCode))
    .execute();
  if (!org[0]) throw new Error(`Организация code=${orgCode} не найдена`);

  const creds: { type: string; key: string }[] = await drizzle
    .select({ type: credentials.type, key: credentials.key })
    .from(credentials)
    .where(
      and(
        eq(credentials.model, "organization"),
        eq(credentials.model_id, org[0].id)
      )
    )
    .execute();
  const apiLogin = creds.find((c) => c.type === "iiko_login")?.key;
  const iikoOrgId = creds.find((c) => c.type === "iiko_id")?.key;
  if (!apiLogin || !iikoOrgId) {
    throw new Error("Нет iiko-кредов организации (iiko_login / iiko_id)");
  }

  const body: any = await (
    await fetchIikoWithRetry(`${IIKO_URL}access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiLogin }),
    })
  ).json();
  if (!body?.token) {
    throw new Error(`iiko не выдал токен: ${body?.errorDescription ?? "нет описания"}`);
  }

  return { token: body.token, iikoOrgId };
}

/** Отправляет команду iikoCloud и ждёт, пока касса её выполнит. */
async function runCommand(
  session: CloudSession,
  path: string,
  payload: Record<string, unknown>
): Promise<{ state: string; error: string | null }> {
  const res = await fetchIikoWithRetry(`${IIKO_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organizationId: session.iikoOrgId, ...payload }),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.correlationId) {
    return {
      state: "Error",
      error: body?.errorDescription ?? `iiko ответил ${res.status} на ${path}`,
    };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < COMMAND_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, COMMAND_POLL_MS));
    const st: any = await (
      await fetchIikoWithRetry(`${IIKO_URL}commands/status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: session.iikoOrgId,
          correlationId: body.correlationId,
        }),
      })
    )
      .json()
      .catch(() => null);

    if (st?.state === "Success") return { state: "Success", error: null };
    if (st?.state === "Error") {
      return {
        state: "Error",
        error: st.errorReason ?? JSON.stringify(st.exception ?? null),
      };
    }
  }

  // Касса не ответила за отведённое время — скорее всего, офлайн. Команда
  // в облаке может выполниться позже, поэтому это не отказ, а неизвестность.
  return {
    state: "InProgress",
    error: "Касса не подтвердила команду за 45 с — возможно, офлайн",
  };
}

/** Время закрытия доставки по iikoServer или null, если там не закрыта. */
async function serverCloseTime(
  cacheController: any,
  orderId: string,
  date: string
): Promise<string | null> {
  const token = await cacheController.getIikoChainToken();
  const res = await fetch(
    `${IIKO_SERVER}/v2/reports/olap?key=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportType: "SALES",
        buildSummary: "false",
        groupByRowFields: ["Delivery.Id", "Delivery.CloseTime"],
        aggregateFields: ["DishDiscountSumInt"],
        filters: {
          "OpenDate.Typed": {
            filterType: "DateRange",
            periodType: "CUSTOM",
            from: dayjs(date).subtract(1, "day").format("YYYY-MM-DD"),
            to: dayjs(date).add(2, "day").format("YYYY-MM-DD"),
            includeLow: true,
            includeHigh: false,
          },
          OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
          // Delivery.Id в фильтр не ставим — iikoServer отдаёт по нему 0 строк.
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`iikoServer ответил ${res.status}`);

  const payload: any = await res.json();
  for (const r of payload?.data ?? []) {
    if (r?.["Delivery.Id"] === orderId) {
      const v = r["Delivery.CloseTime"];
      return typeof v === "string" && v.trim() !== "" ? v : null;
    }
  }

  return null;
}

/** OLAP отдаёт "" вместо null у пустых полей. */
const olapVal = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/**
 * Доставки из iikoServer за [minDate, maxDate], понедельно, по Delivery.Id.
 * Фильтр по Delivery.Id не ставим — iikoServer отдаёт по нему 0 строк.
 */
async function olapDeliveries(
  cacheController: any,
  minDate: string,
  maxDate: string,
  onWeek?: (from: string) => unknown
): Promise<Map<string, any>> {
  const token = await cacheController.getIikoChainToken();
  const byId = new Map<string, any>();

  for (
    let from = minDate;
    from <= maxDate;
    from = dayjs(from).add(7, "day").format("YYYY-MM-DD")
  ) {
    await onWeek?.(from);
    const res = await fetch(
      `${IIKO_SERVER}/v2/reports/olap?key=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: "SALES",
          buildSummary: "false",
          groupByRowFields: ["Delivery.Id", "Delivery.CloseTime"],
          aggregateFields: ["DishDiscountSumInt"],
          filters: {
            "OpenDate.Typed": {
              filterType: "DateRange",
              periodType: "CUSTOM",
              from: dayjs(from).subtract(1, "day").format("YYYY-MM-DD"),
              to: dayjs(from).add(8, "day").format("YYYY-MM-DD"),
              includeLow: true,
              includeHigh: false,
            },
            OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
          },
        }),
      }
    );
    if (!res.ok) throw new Error(`iikoServer ответил ${res.status} за неделю с ${from}`);
    const payload: any = await res.json();
    for (const r of payload?.data ?? []) {
      if (r?.["Delivery.Id"]) byId.set(r["Delivery.Id"], r);
    }
  }

  return byId;
}

// Массовая отмена: фоновой задачей, статус в Redis.
const BULK_MAX = 2000;
// Сколько заказов отменяем одновременно. Команды уходят на разные кассы,
// но iikoCloud один — не разгоняем.
const BULK_CONCURRENCY = 3;
// Столько ошибок кассы подряд — и прогон останавливается: что-то не так
// системно (касса офлайн, старые заказы не принимаются), а не с заказом.
const BULK_STOP_AFTER_ERRORS = 5;
const BULK_LOCK = `${process.env.PROJECT_PREFIX}hanging_bulk_cancel:lock`;
const bulkJobKey = (id: string) =>
  `${process.env.PROJECT_PREFIX}hanging_bulk_cancel:${id}`;

type BulkStats = {
  total: number;
  done: number;
  cancelled: number;
  alreadyClosed: number;
  errors: number;
  pending: number;
  stopped: boolean;
  errorSamples: string[];
};

type RefreshReport = {
  brand: string;
  dates: string[];
  checked: number;
  updated: number;
  closed: number;
  errors: string[];
};

// Сверка с iiko за окно [since, until]: облако по дням, затем iikoServer
// понедельно. Вызывается и прямо из запроса, и фоновой задачей.
type RefreshArgs = {
  brands: string[];
  since: string;
  until: string;
  drizzle: DrizzleDB;
  cacheController: any;
  progress?: (text: string) => unknown;
};

async function runRefresh({
  brands,
  since,
  until,
  drizzle,
  cacheController,
  progress,
}: RefreshArgs): Promise<RefreshReport[]> {
  const summary: RefreshReport[] = [];

  for (const currentBrand of brands) {
    const report: RefreshReport = {
      brand: currentBrand,
      dates: [],
      checked: 0,
      updated: 0,
      closed: 0,
      errors: [],
    };
    summary.push(report);

    const orgCode = BRAND_ORG_CODE[currentBrand];
    if (!orgCode) {
      report.errors.push(`Неизвестный бренд: ${currentBrand}`);
      continue;
    }

    const openRows = await drizzle
      .select({
        id: hangingOrders.id,
        orderId: hangingOrders.orderId,
        date: hangingOrders.date,
        orderStatus: hangingOrders.orderStatus,
      })
      .from(hangingOrders)
      .where(
        and(
          eq(hangingOrders.brand, currentBrand),
          gte(hangingOrders.date, since),
          lte(hangingOrders.date, until),
          or(
            isNull(hangingOrders.orderStatus),
            notInArray(hangingOrders.orderStatus, FINAL_STATUSES)
          )
        )
      )
      .execute();

    report.checked = openRows.length;
    if (openRows.length === 0) continue;

    const org = await drizzle
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.code, orgCode))
      .execute();

    if (!org[0]) {
      report.errors.push(
        `${currentBrand}: организация с code=${orgCode} не найдена`
      );
      continue;
    }

    const orgCreds = await drizzle
      .select({ type: credentials.type, key: credentials.key })
      .from(credentials)
      .where(
        and(
          eq(credentials.model, "organization"),
          eq(credentials.model_id, org[0].id)
        )
      )
      .execute();

    const apiLogin = orgCreds.find((c) => c.type === "iiko_login")?.key;
    const iikoOrgId = orgCreds.find((c) => c.type === "iiko_id")?.key;
    if (!apiLogin || !iikoOrgId) {
      report.errors.push(
        `${currentBrand}: нет iiko-кредов организации (iiko_login / iiko_id)`
      );
      continue;
    }

    let token: string | undefined;
    try {
      const tokenBody: any = await (
        await fetchIikoWithRetry(`${IIKO_URL}access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiLogin }),
        })
      ).json();
      token = tokenBody?.token;
      if (!token) {
        report.errors.push(
          `${currentBrand}: iiko не выдал токен — ${
            tokenBody?.errorDescription ?? "нет описания"
          }`
        );
        continue;
      }
    } catch (e: any) {
      report.errors.push(
        `${currentBrand}: ошибка access_token — ${e.message}`
      );
      continue;
    }

    const dates = [...new Set(openRows.map((r) => r.date))].sort();
    report.dates = dates;

    for (const [di, date] of dates.entries()) {
      await progress?.(
        `${currentBrand}: iikoCloud, день ${di + 1} из ${dates.length}`
      );
      if (date !== dates[0]) {
        await new Promise((r) => setTimeout(r, CLOUD_PAUSE_MS));
      }
      const freshById = new Map<string, any>();
      try {
        const res = await fetchIikoWithRetry(
          `${IIKO_URL}deliveries/by_delivery_date_and_status`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              organizationIds: [iikoOrgId],
              deliveryDateFrom: `${date} 00:00:00.123`,
              deliveryDateTo: `${date} 23:59:59.123`,
              statuses: ALL_DELIVERY_STATUSES,
            }),
          }
        );
        if (!res.ok) {
          report.errors.push(
            `${currentBrand} ${date}: iiko ответил ${res.status} ${res.statusText}`
          );
          continue;
        }
        const payload: any = await res.json();
        for (const byOrg of payload?.ordersByOrganizations ?? []) {
          for (const order of byOrg?.orders ?? []) {
            if (order?.id) freshById.set(order.id, order);
          }
        }
      } catch (e: any) {
        report.errors.push(`${currentBrand} ${date}: ${e.message}`);
        continue;
      }

      for (const row of openRows.filter((r) => r.date === date)) {
        const fresh = row.orderId ? freshById.get(row.orderId) : undefined;
        // Заказа нет в ответе — строку не трогаем: устаревший статус лучше,
        // чем затирание по неполному ответу iiko.
        if (!fresh) continue;

        const nextStatus: string | undefined = fresh.order?.status;
        // NULL не пишем: список в админке фильтруется через NOT IN, а он
        // отбрасывает строки с NULL — заказ бы просто исчез со страницы.
        if (!nextStatus) continue;

        // Пишем всегда, а не только при смене статуса: отметки этапов
        // двигаются и у заказа, который так и остался в Waiting — именно
        // они показывают, на чём он застрял.
        await drizzle
          .update(hangingOrders)
          .set({
            orderStatus: nextStatus,
            problem:
              fresh.order?.problem?.description
                ?.replace(/\n/g, " ")
                .trim() || null,
            amount:
              fresh.order?.sum != null ? String(fresh.order.sum) : null,
            whenPrinted: fresh.order?.whenPrinted ?? null,
            whenCookingCompleted: fresh.order?.whenCookingCompleted ?? null,
            whenSended: fresh.order?.whenSended ?? null,
            whenDelivered: fresh.order?.whenDelivered ?? null,
            whenClosed: fresh.order?.whenClosed ?? null,
            updatedAt: new Date(),
          })
          .where(eq(hangingOrders.id, row.id))
          .execute();

        if (nextStatus !== row.orderStatus) {
          report.updated++;
          if (FINAL_STATUSES.includes(nextStatus)) {
            report.closed++;
          }
        }
      }
    }
  }

  // Второй проход — iikoServer (OLAP). iikoCloud не всегда получает
  // закрытие, сделанное в бэк-офисе: 08.10 пачка заказов, закрытых в
  // iikoChain за 17:40–17:43, так и осталась в облаке в Waiting с пустыми
  // whenSended/whenClosed. OLAP видит закрытие по Delivery.CloseTime, а
  // Delivery.Id в нём совпадает с нашим order_id.
  const stillOpen = await drizzle
    .select({
      id: hangingOrders.id,
      orderId: hangingOrders.orderId,
      brand: hangingOrders.brand,
      date: hangingOrders.date,
    })
    .from(hangingOrders)
    .where(
      and(
        inArray(hangingOrders.brand, brands),
        gte(hangingOrders.date, since),
        lte(hangingOrders.date, until),
        or(
          isNull(hangingOrders.orderStatus),
          notInArray(hangingOrders.orderStatus, FINAL_STATUSES)
        )
      )
    )
    .execute();

  const ids = stillOpen
    .map((r) => r.orderId)
    .filter((v): v is string => !!v);

  if (ids.length > 0) {
    const dates = stillOpen.map((r) => r.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const fail = (why: string) =>
      summary.forEach((r) => r.errors.push(`OLAP: ${why}`));
    // OLAP отдаёт "" вместо null у пустых полей.
    const val = (v: unknown) =>
      typeof v === "string" && v.trim() !== "" ? v : null;

    try {
      const token = await cacheController.getIikoChainToken();
      const byId = new Map<string, any>();

      // Понедельно: неделя — ~17 тыс. строк за ~4 с, а четыре месяца
      // одним запросом — сотни тысяч.
      for (
        let from = minDate;
        from <= maxDate;
        from = dayjs(from).add(7, "day").format("YYYY-MM-DD")
      ) {
        await progress?.(
          `iikoServer: неделя с ${dayjs(from).format("DD.MM")} по ${dayjs(maxDate).format("DD.MM")}`
        );
        const res = await fetch(
          `${IIKO_SERVER}/v2/reports/olap?key=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reportType: "SALES",
              buildSummary: "false",
              groupByRowFields: [
                "Delivery.Id",
                "Delivery.PrintTime",
                "Delivery.CookingFinishTime",
                "Delivery.SendTime",
                "Delivery.ActualTime",
                "Delivery.CloseTime",
              ],
              aggregateFields: ["DishDiscountSumInt"],
              filters: {
                "OpenDate.Typed": {
                  filterType: "DateRange",
                  periodType: "CUSTOM",
                  // Заказ мог открыться накануне даты доставки.
                  from: dayjs(from).subtract(1, "day").format("YYYY-MM-DD"),
                  to: dayjs(from).add(8, "day").format("YYYY-MM-DD"),
                  includeLow: true,
                  includeHigh: false,
                },
                OrderDeleted: {
                  filterType: "IncludeValues",
                  values: ["NOT_DELETED"],
                },
                // Фильтр по Delivery.Id сюда не ставим: iikoServer
                // принимает его, но молча отдаёт 0 строк (проверено
                // 2026-10-09). Сверяем по id уже в памяти.
              },
            }),
          }
        );

        if (!res.ok) {
          fail(`iikoServer ответил ${res.status} за неделю с ${from}`);
          continue;
        }
        const payload: any = await res.json();
        for (const r of payload?.data ?? []) {
          if (r?.["Delivery.Id"]) byId.set(r["Delivery.Id"], r);
        }
      }

      for (const row of stillOpen) {
        const o = row.orderId ? byId.get(row.orderId) : undefined;
        const closedAt = val(o?.["Delivery.CloseTime"]);
        if (!closedAt) continue;

        await drizzle
          .update(hangingOrders)
          .set({
            orderStatus: "Closed",
            whenPrinted: val(o["Delivery.PrintTime"]),
            whenCookingCompleted: val(o["Delivery.CookingFinishTime"]),
            whenSended: val(o["Delivery.SendTime"]),
            whenDelivered: val(o["Delivery.ActualTime"]),
            whenClosed: closedAt,
            updatedAt: new Date(),
          })
          .where(eq(hangingOrders.id, row.id))
          .execute();

        const report = summary.find((r) => r.brand === row.brand);
        if (report) {
          report.updated++;
          report.closed++;
        }
      }
    } catch (e: any) {
      fail(e?.message ?? String(e));
    }
  }

  return summary;
}

// До недели сверяем прямо в запросе, дольше — фоновой задачей.
const INLINE_MAX_DAYS = 7;
const REFRESH_LOCK = `${process.env.PROJECT_PREFIX}hanging_refresh:lock`;
const refreshJobKey = (id: string) =>
  `${process.env.PROJECT_PREFIX}hanging_refresh:${id}`;

export const hangingOrdersController = new Elysia({
  name: "@api/hanging-orders",
})
  .use(ctx)
  .get(
    "/hanging-orders",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, hangingOrders, {});
      } else {
        selectFields = getTableColumns(hangingOrders);
      }

      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        try {
          whereClause = parseFilterFields(filters, hangingOrders, {});
        } catch (error) {
          console.error('Error parsing filters:', error);
          throw error;
        }
      }

      const ordersCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(hangingOrders)
        .where(and(...whereClause))
        .execute();

      let orderByClause = desc(hangingOrders.createdAt); // default ordering
      if (sort) {
        const [field, direction] = sort.split(':');
        const column = hangingOrders[field as keyof typeof hangingOrders];
        if (column && typeof column === 'object' && 'name' in column) {
          orderByClause = direction === 'desc' ? desc(column as any) : asc(column as any);
        }
      }

      const ordersList = await drizzle
        .select(selectFields)
        .from(hangingOrders)
        .where(and(...whereClause))
        .orderBy(orderByClause)
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: ordersCount[0].count,
        data: ordersList,
      };
    },
    {
      permission: "hanging_orders.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/hanging-orders/:id",
    async ({
      params: { id },
      user,
      set,
      drizzle,
    }) => {
      const order = await drizzle
        .select()
        .from(hangingOrders)
        .where(eq(hangingOrders.id, id))
        .execute();

      if (!order[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        data: order[0],
      };
    },
    {
      permission: "hanging_orders.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/hanging-orders",
    async ({ body: { data, fields }, user, set, drizzle }) => {
      let selectFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, hangingOrders, {});
      } else {
        selectFields = {
          id: hangingOrders.id,
        };
      }

      const result = await drizzle
        .insert(hangingOrders)
        .values(data)
        .returning(selectFields);

      return result[0];
    },
    {
      permission: "hanging_orders.add",
      body: t.Object({
        data: createInsertSchema(hangingOrders) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .put(
    "/hanging-orders/:id",
    async ({
      params: { id },
      body: { data, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, hangingOrders, {});
      }

      data.updatedAt = new Date();

      const result = await drizzle
        .update(hangingOrders)
        .set(data)
        .where(eq(hangingOrders.id, id))
        .returning(selectFields);

      if (!result[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        data: result[0],
      };
    },
    {
      permission: "hanging_orders.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: createInsertSchema(hangingOrders) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .delete(
    "/hanging-orders/:id",
    async ({
      params: { id },
      user,
      set,
      drizzle,
    }) => {
      const result = await drizzle
        .delete(hangingOrders)
        .where(eq(hangingOrders.id, id))
        .returning({ id: hangingOrders.id });

      if (!result[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        message: "Order deleted successfully",
        data: result[0],
      };
    },
    {
      permission: "hanging_orders.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .patch(
    "/hanging-orders/:id/status",
    async ({
      params: { id },
      body: { status, comment },
      user,
      set,
      drizzle,
    }) => {
      const result = await drizzle
        .update(hangingOrders)
        .set({
          status,
          comment,
          updatedAt: new Date(),
        })
        .where(eq(hangingOrders.id, id))
        .returning();

      if (!result[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        data: result[0],
      };
    },
    {
      permission: "hanging_orders.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        status: t.Optional(t.String()),
        comment: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/hanging-orders/facets",
    async ({ query: { filters }, drizzle }) => {
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, hangingOrders, {});
      }

      const pick = async (column: PgColumn): Promise<string[]> => {
        // selectDistinct по динамической колонке не выводит тип значения.
        const rows = (await drizzle
          .selectDistinct({ value: column })
          .from(hangingOrders)
          .where(and(...whereClause))
          .execute()) as { value: string | null }[];

        return rows
          .map((r) => r.value)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .sort((a, b) => a.localeCompare(b, "ru"));
      };

      return {
        data: {
          conception: await pick(hangingOrders.conception),
          orderType: await pick(hangingOrders.orderType),
          paymentType: await pick(hangingOrders.paymentType),
          orderStatus: await pick(hangingOrders.orderStatus),
        },
      };
    },
    {
      permission: "hanging_orders.list",
      query: t.Object({
        filters: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/hanging-orders/iiko-actions/options",
    async ({ query: { brand }, drizzle, set }) => {
      try {
        const session = await cloudSession(drizzle, brand);
        const call = async (path: string) =>
          (await (
            await fetchIikoWithRetry(`${IIKO_URL}${path}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ organizationIds: [session.iikoOrgId] }),
            })
          ).json()) as any;

        const causes = await call("cancel_causes");
        const removal = await call("removal_types");

        return {
          data: {
            cancelCauses: (causes?.cancelCauses ?? [])
              .filter((c: any) => !c.isDeleted)
              .map((c: any) => ({ id: c.id, name: c.name })),
            removalTypes: (removal?.removalTypes ?? [])
              .filter((t: any) => !t.isDeleted)
              .map((t: any) => ({ id: t.id, name: t.name })),
          },
        };
      } catch (e: any) {
        set.status = 502;
        return { message: e?.message ?? String(e) };
      }
    },
    {
      permission: ACTION_PERMISSION,
      query: t.Object({
        brand: t.Union([t.Literal("chopar"), t.Literal("les_ailes")]),
      }),
    }
  )
  .post(
    "/hanging-orders/:id/iiko-close",
    async ({ params: { id }, drizzle, cacheController, user, set }) => {
      const [row] = await drizzle
        .select()
        .from(hangingOrders)
        .where(eq(hangingOrders.id, id))
        .execute();
      if (!row) {
        set.status = 404;
        return { message: "Заказ не найден" };
      }
      if (!row.orderId) {
        set.status = 409;
        return { message: "У строки нет id заказа iiko" };
      }
      if (row.orderStatus && FINAL_STATUSES.includes(row.orderStatus)) {
        set.status = 409;
        return { message: `Заказ уже в статусе ${row.orderStatus}` };
      }

      const log = (state: string, error: string | null, params: unknown = null) =>
        drizzle
          .insert(hangingOrderActions)
          .values({
            hangingOrderId: row.id,
            orderId: row.orderId,
            action: "close",
            userId: user?.id ?? null,
            userLogin: user?.login ?? null,
            params,
            state,
            error,
          })
          .execute();

      try {
        // Уже закрыт в бэк-офисе — кассе ничего не шлём, просто догоняем.
        const closedAt = await serverCloseTime(cacheController, row.orderId, row.date);
        if (closedAt) {
          await drizzle
            .update(hangingOrders)
            .set({ orderStatus: "Closed", whenClosed: closedAt, updatedAt: new Date() })
            .where(eq(hangingOrders.id, row.id))
            .execute();
          await log("Success", null, { alreadyClosedInServer: closedAt });
          return { data: { state: "Success", message: `Уже закрыт в iikoServer (${closedAt})` } };
        }

        const session = await cloudSession(drizzle, row.brand);

        if (row.orderStatus !== "Delivered") {
          const delivered = await runCommand(session, "deliveries/update_order_delivery_status", {
            orderId: row.orderId,
            deliveryStatus: "Delivered",
          });
          if (delivered.state !== "Success") {
            await log(delivered.state, delivered.error, { step: "delivered" });
            set.status = delivered.state === "InProgress" ? 202 : 502;
            return { data: delivered, message: delivered.error };
          }
        }

        const closed = await runCommand(session, "deliveries/close", { orderId: row.orderId });
        await log(closed.state, closed.error, { step: "close" });
        if (closed.state !== "Success") {
          set.status = closed.state === "InProgress" ? 202 : 502;
          return { data: closed, message: closed.error };
        }

        await drizzle
          .update(hangingOrders)
          .set({
            orderStatus: "Closed",
            whenClosed: dayjs().format("YYYY-MM-DD HH:mm:ss"),
            updatedAt: new Date(),
          })
          .where(eq(hangingOrders.id, row.id))
          .execute();

        return { data: { state: "Success", message: "Заказ закрыт в iiko" } };
      } catch (e: any) {
        const message = e?.message ?? String(e);
        await log("Error", message);
        set.status = 502;
        return { message };
      }
    },
    {
      permission: ACTION_PERMISSION,
      params: t.Object({ id: t.String() }),
    }
  )
  .post(
    "/hanging-orders/:id/iiko-cancel",
    async ({ params: { id }, body, drizzle, cacheController, user, set }) => {
      const [row] = await drizzle
        .select()
        .from(hangingOrders)
        .where(eq(hangingOrders.id, id))
        .execute();
      if (!row) {
        set.status = 404;
        return { message: "Заказ не найден" };
      }
      if (!row.orderId) {
        set.status = 409;
        return { message: "У строки нет id заказа iiko" };
      }
      if (row.orderStatus && FINAL_STATUSES.includes(row.orderStatus)) {
        set.status = 409;
        return { message: `Заказ уже в статусе ${row.orderStatus}` };
      }

      const log = (state: string, error: string | null) =>
        drizzle
          .insert(hangingOrderActions)
          .values({
            hangingOrderId: row.id,
            orderId: row.orderId,
            action: "cancel",
            userId: user?.id ?? null,
            userLogin: user?.login ?? null,
            params: body,
            state,
            error,
          })
          .execute();

      try {
        // Закрыт в бэк-офисе = оплачен. Отмена стала бы сторно — запрещаем
        // и заодно чиним статус у себя.
        const closedAt = await serverCloseTime(cacheController, row.orderId, row.date);
        if (closedAt) {
          await drizzle
            .update(hangingOrders)
            .set({ orderStatus: "Closed", whenClosed: closedAt, updatedAt: new Date() })
            .where(eq(hangingOrders.id, row.id))
            .execute();
          const message = `Отмена запрещена: в iikoServer заказ закрыт ${closedAt}`;
          await log("Refused", message);
          set.status = 409;
          return { message };
        }

        const session = await cloudSession(drizzle, row.brand);
        const cancelled = await runCommand(session, "deliveries/cancel", {
          orderId: row.orderId,
          cancelCauseId: body.cancelCauseId,
          removalTypeId: body.removalTypeId,
          ...(body.comment
            ? { cancelComment: body.comment, removalComment: body.comment }
            : {}),
        });
        await log(cancelled.state, cancelled.error);

        if (cancelled.state !== "Success") {
          set.status = cancelled.state === "InProgress" ? 202 : 502;
          return { data: cancelled, message: cancelled.error };
        }

        await drizzle
          .update(hangingOrders)
          .set({ orderStatus: "Cancelled", updatedAt: new Date() })
          .where(eq(hangingOrders.id, row.id))
          .execute();

        return { data: { state: "Success", message: "Заказ отменён в iiko" } };
      } catch (e: any) {
        const message = e?.message ?? String(e);
        await log("Error", message);
        set.status = 502;
        return { message };
      }
    },
    {
      permission: ACTION_PERMISSION,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        cancelCauseId: t.String({ minLength: 1 }),
        removalTypeId: t.String({ minLength: 1 }),
        comment: t.Optional(t.String({ maxLength: 500 })),
      }),
    }
  )
  .post(
    "/hanging-orders/iiko-cancel-bulk",
    async ({ body, drizzle, cacheController, redis, user, set }) => {
      const floor = dayjs()
        .subtract(MAX_WINDOW_MONTHS, "month")
        .format("YYYY-MM-DD");

      let where: (SQLWrapper | undefined)[];
      if (body.ids?.length) {
        where = [inArray(hangingOrders.id, body.ids)];
      } else if (body.filters) {
        where = parseFilterFields(body.filters, hangingOrders, {});
      } else {
        set.status = 400;
        return { message: "Нужны выбранные заказы или фильтр" };
      }

      // Только висящие, с id в iiko и не старше MAX_WINDOW_MONTHS — что бы ни
      // пришло с клиента.
      const rows = await drizzle
        .select({
          id: hangingOrders.id,
          orderId: hangingOrders.orderId,
          brand: hangingOrders.brand,
          date: hangingOrders.date,
          comment: hangingOrders.comment,
        })
        .from(hangingOrders)
        .where(
          and(
            ...where,
            gte(hangingOrders.date, floor),
            isNotNull(hangingOrders.orderId),
            or(
              isNull(hangingOrders.orderStatus),
              notInArray(hangingOrders.orderStatus, FINAL_STATUSES)
            )
          )
        )
        .limit(BULK_MAX + 1)
        .execute();

      if (rows.length === 0) {
        set.status = 400;
        return {
          message: `Ни одного висящего заказа за последние ${MAX_WINDOW_MONTHS} месяцев под условие не попало`,
        };
      }
      if (rows.length > BULK_MAX) {
        set.status = 400;
        return { message: `Больше ${BULK_MAX} заказов — сузьте фильтр` };
      }

      const jobId = crypto.randomUUID();
      const locked = await redis.set(BULK_LOCK, jobId, "EX", 7200, "NX");
      if (!locked) {
        set.status = 409;
        return {
          message: "Массовая отмена уже идёт — дождитесь её",
          job: { id: await redis.get(BULK_LOCK) },
        };
      }

      const stats: BulkStats = {
        total: rows.length,
        done: 0,
        cancelled: 0,
        alreadyClosed: 0,
        errors: 0,
        pending: 0,
        stopped: false,
        errorSamples: [],
      };
      const save = (state: string, progress: string) =>
        redis.set(
          bulkJobKey(jobId),
          JSON.stringify({ state, progress, stats }),
          "EX",
          86400
        );
      await save("running", "старт");

      const log = (
        row: (typeof rows)[number],
        state: string,
        error: string | null,
        extra: Record<string, unknown> = {}
      ) =>
        drizzle
          .insert(hangingOrderActions)
          .values({
            hangingOrderId: row.id,
            orderId: row.orderId,
            action: "cancel",
            userId: user?.id ?? null,
            userLogin: user?.login ?? null,
            params: {
              bulkJobId: jobId,
              cancelCause: body.cancelCauseName,
              removalType: body.removalTypeName,
              ...extra,
            },
            state,
            error,
          })
          .execute();

      const fail = (row: (typeof rows)[number], why: string) => {
        stats.errors++;
        if (stats.errorSamples.length < 10) {
          stats.errorSamples.push(`${row.date}: ${why}`);
        }
      };

      void (async () => {
        try {
          // 1. Закрытые в бэк-офисе не отменяем: это оплаченные заказы.
          const dates = rows.map((r) => r.date).sort();
          const server = await olapDeliveries(
            cacheController,
            dates[0],
            dates[dates.length - 1],
            (from) =>
              save("running", `проверяю iikoServer: неделя с ${dayjs(from).format("DD.MM")}`)
          );

          const toCancel: typeof rows = [];
          for (const row of rows) {
            const closedAt = olapVal(server.get(row.orderId!)?.["Delivery.CloseTime"]);
            if (!closedAt) {
              toCancel.push(row);
              continue;
            }
            await drizzle
              .update(hangingOrders)
              .set({ orderStatus: "Closed", whenClosed: closedAt, updatedAt: new Date() })
              .where(eq(hangingOrders.id, row.id))
              .execute();
            await log(row, "Refused", `в iikoServer закрыт ${closedAt}`);
            stats.alreadyClosed++;
            stats.done++;
          }

          // 2. Сессия и id причины/типа удаления — свои у каждого бренда.
          type Prep = { session: CloudSession; causeId: string; removalId: string };
          const preps = new Map<string, Promise<Prep>>();
          const prepare = (brand: string) => {
            let pr = preps.get(brand);
            if (!pr) {
              pr = (async () => {
                const session = await cloudSession(drizzle, brand);
                const list = async (path: string) =>
                  (await (
                    await fetchIikoWithRetry(`${IIKO_URL}${path}`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${session.token}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ organizationIds: [session.iikoOrgId] }),
                    })
                  ).json()) as any;
                const cause = ((await list("cancel_causes"))?.cancelCauses ?? []).find(
                  (c: any) => !c.isDeleted && c.name === body.cancelCauseName
                );
                const removal = ((await list("removal_types"))?.removalTypes ?? []).find(
                  (t: any) => !t.isDeleted && t.name === body.removalTypeName
                );
                if (!cause) throw new Error(`у ${brand} нет причины «${body.cancelCauseName}»`);
                if (!removal) throw new Error(`у ${brand} нет типа удаления «${body.removalTypeName}»`);
                return { session, causeId: cause.id, removalId: removal.id };
              })();
              preps.set(brand, pr);
            }
            return pr;
          };

          // 3. Отмена. Комментарий — «Заметка» заказа, без неё — общий.
          let next = 0;
          let streak = 0;
          const worker = async () => {
            while (next < toCancel.length && !stats.stopped) {
              const row = toCancel[next++];
              const comment = (row.comment?.trim() || body.fallbackComment?.trim() || "").slice(0, 500);

              try {
                const prep = await prepare(row.brand);
                const result = await runCommand(prep.session, "deliveries/cancel", {
                  orderId: row.orderId,
                  cancelCauseId: prep.causeId,
                  removalTypeId: prep.removalId,
                  ...(comment ? { cancelComment: comment, removalComment: comment } : {}),
                });
                await log(row, result.state, result.error, { comment });

                if (result.state === "Success") {
                  await drizzle
                    .update(hangingOrders)
                    .set({ orderStatus: "Cancelled", updatedAt: new Date() })
                    .where(eq(hangingOrders.id, row.id))
                    .execute();
                  stats.cancelled++;
                  streak = 0;
                } else if (result.state === "InProgress") {
                  stats.pending++;
                  streak = 0;
                } else {
                  fail(row, result.error ?? "касса отказала");
                  streak++;
                }
              } catch (e: any) {
                const why = e?.message ?? String(e);
                await log(row, "Error", why, { comment });
                fail(row, why);
                streak++;
              }

              stats.done++;
              if (streak >= BULK_STOP_AFTER_ERRORS) stats.stopped = true;
              await save(
                "running",
                `отменено ${stats.cancelled}, обработано ${stats.done} из ${stats.total}`
              );
            }
          };
          await Promise.all(Array.from({ length: BULK_CONCURRENCY }, worker));

          await save(stats.stopped ? "stopped" : "done", "готово");
        } catch (e: any) {
          stats.errorSamples.push(e?.message ?? String(e));
          await save("error", e?.message ?? String(e));
        } finally {
          if ((await redis.get(BULK_LOCK)) === jobId) await redis.del(BULK_LOCK);
        }
      })();

      return { job: { id: jobId }, total: rows.length };
    },
    {
      permission: ACTION_PERMISSION,
      body: t.Object({
        ids: t.Optional(t.Array(t.String(), { maxItems: BULK_MAX })),
        filters: t.Optional(t.String()),
        cancelCauseName: t.String({ minLength: 1 }),
        removalTypeName: t.String({ minLength: 1 }),
        fallbackComment: t.Optional(t.String({ maxLength: 500 })),
      }),
    }
  )
  .get(
    "/hanging-orders/iiko-cancel-bulk/:jobId",
    async ({ params: { jobId }, redis, set }) => {
      const raw = await redis.get(bulkJobKey(jobId));
      if (!raw) {
        set.status = 404;
        return { message: "Задача не найдена или устарела" };
      }
      return JSON.parse(raw);
    },
    {
      permission: ACTION_PERMISSION,
      params: t.Object({ jobId: t.String() }),
    }
  )
  .get(
    "/hanging-orders/refresh/:jobId",
    async ({ params: { jobId }, redis, set }) => {
      const raw = await redis.get(refreshJobKey(jobId));
      if (!raw) {
        set.status = 404;
        return { message: "Задача не найдена или устарела" };
      }
      return JSON.parse(raw);
    },
    {
      permission: "hanging_orders.edit",
      params: t.Object({ jobId: t.String() }),
    }
  )
  .post(
    "/hanging-orders/refresh",
    async ({ body: { brand, days, dateFrom, dateTo }, drizzle, cacheController, redis }) => {
      const brands = brand ? [brand] : Object.keys(BRAND_ORG_CODE);
      // Окно: период из фильтра страницы или последние `days` дней,
      // но не глубже MAX_WINDOW_MONTHS.
      const floor = dayjs()
        .subtract(MAX_WINDOW_MONTHS, "month")
        .format("YYYY-MM-DD");
      const requested =
        dateFrom ?? dayjs().subtract(days ?? 3, "day").format("YYYY-MM-DD");
      const since = requested < floor ? floor : requested;
      const until = dateTo ?? dayjs().format("YYYY-MM-DD");

      const window = { from: since, to: until };
      const span = dayjs(until).diff(dayjs(since), "day") + 1;

      // Короткий период — сразу, в этом же запросе.
      if (span <= INLINE_MAX_DAYS) {
        const summary = await runRefresh({
          brands, since, until, drizzle, cacheController,
        });
        return { data: summary, window };
      }

      // Длинный — фоновой задачей: прокси ждёт бэкенд 60 с, а четыре месяца
      // сверяются минутами. Статус в Redis — бэкенд крутится в нескольких
      // процессах, и опрос может прийти не в тот, где идёт задача.
      const jobId = crypto.randomUUID();
      const locked = await redis.set(REFRESH_LOCK, jobId, "EX", 1800, "NX");
      if (!locked) {
        const running = await redis.get(REFRESH_LOCK);
        return { job: { id: running, alreadyRunning: true }, window };
      }

      const save = (state: unknown) =>
        redis.set(refreshJobKey(jobId), JSON.stringify(state), "EX", 3600);
      await save({ state: "running", progress: "старт", window });

      void (async () => {
        try {
          const summary = await runRefresh({
            brands, since, until, drizzle, cacheController,
            progress: (text) => save({ state: "running", progress: text, window }),
          });
          await save({ state: "done", data: summary, window });
        } catch (e: any) {
          await save({ state: "error", message: e?.message ?? String(e), window });
        } finally {
          if ((await redis.get(REFRESH_LOCK)) === jobId) {
            await redis.del(REFRESH_LOCK);
          }
        }
      })();

      return { job: { id: jobId }, window };
    },
    {
      permission: "hanging_orders.edit",
      body: t.Object({
        brand: t.Optional(
          t.Union([t.Literal("chopar"), t.Literal("les_ailes")])
        ),
        days: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
        dateFrom: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
        dateTo: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
      }),
    }
  );