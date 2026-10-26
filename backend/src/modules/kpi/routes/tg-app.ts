import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { now } from "../clock";
import { KpiError, run } from "../errors";
import { setLang } from "../tg/bindings";
import { botApi } from "../tg/bot-api";
import { syncMenuButton } from "../tg/menu";
import { authenticate } from "../tg-app/auth";
import { kpiTgCtx, requireEmployee } from "../tg-app/ctx";
import { historyFor, homeFor } from "../tg-app/home";
import { disputeFromApp, ownPhoto, reviewFor, violationsOf } from "../tg-app/review";
import type { TgDisputeCreated, TgLangResponse, TgReview, TgViolations } from "../tg-app/types";

// Роуты мини-приложения «Мой KPI». Ничего здесь не логирует init_data и токены.
// POST /kpi/tg/auth публичный и объявлен ДО .use(kpiTgCtx): хуки плагина действуют только на роуты,
// объявленные после .use(), поэтому всё ниже требует Bearer-сессию, а вход — нет.
export const tgAppRoutes = new Elysia({ name: "@api/kpi/tg-app" })
  .use(ctx)
  .post(
    "/kpi/tg/auth",
    async ({ body, drizzle, redis, set }) =>
      run(set, async () => authenticate(drizzle, redis, body.init_data, Math.floor(Date.now() / 1000))),
    // Значение проверяет authenticate: не строка — 401 bad_init_data, а не ответ схемы.
    { body: t.Object({ init_data: t.Optional(t.Any()) }) }
  )
  .use(kpiTgCtx)
  .put(
    "/kpi/tg/lang",
    async ({ body, tg, drizzle, set }) =>
      run(set, async (): Promise<TgLangResponse> => {
        const lang = body.lang;
        if (lang !== "ru" && lang !== "uz") throw new KpiError(422, "bad_lang");
        // null — привязки сняли между guard и записью: сессии больше нет.
        if (!(await setLang(drizzle, tg.telegram_id, lang))) throw new KpiError(401, "unauthorized");
        // Кнопка меню только при смене языка и без ожидания: повтор PUT /lang не должен упирать бота в лимит Telegram.
        if (lang !== tg.lang) void syncMenuButton(botApi(), tg.telegram_id, lang);
        return { lang };
      }),
    { body: t.Object({ lang: t.Optional(t.Any()) }) }
  )
  .get("/kpi/tg/home", async ({ tg, drizzle, set }) => run(set, async () => homeFor(drizzle, tg, now())))
  // requireEmployee внутри run: 403 not_employee уходит ответом, а не 500.
  .get("/kpi/tg/history", async ({ tg, drizzle, set }) => run(set, async () => historyFor(drizzle, requireEmployee(tg), now())))
  // period проверяет parsePeriod: кривой или пустой — наш 422 bad_period, а не ответ схемы.
  .get(
    "/kpi/tg/review",
    async ({ query, tg, drizzle, set }) =>
      run(set, async (): Promise<TgReview> => reviewFor(drizzle, requireEmployee(tg), query.period, now())),
    { query: t.Object({ period: t.Optional(t.Any()) }) }
  )
  .get(
    "/kpi/tg/violations",
    async ({ query, tg, drizzle, set }) =>
      run(set, async (): Promise<TgViolations> => violationsOf(drizzle, requireEmployee(tg), query.period, now())),
    { query: t.Object({ period: t.Optional(t.Any()) }) }
  )
  // Заголовки — как у админского /kpi/violation-photos/:id/file.
  .get(
    "/kpi/tg/violation-photos/:id/file",
    async ({ params, tg, drizzle, set }) => {
      const r = await run(set, async () => ownPhoto(drizzle, requireEmployee(tg), params.id));
      if ("error" in r) return r;
      set.headers["content-type"] = r.mime;
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["cache-control"] = "private, max-age=3600";
      return Bun.file(r.path);
    },
    { params: t.Object({ id: t.String() }) }
  )
  .post(
    "/kpi/tg/disputes",
    async ({ body, tg, drizzle, set }) =>
      run(set, async (): Promise<TgDisputeCreated> => disputeFromApp(drizzle, requireEmployee(tg), body)),
    // Значения проверяет disputeFromApp и openDispute: неверное — наш код ошибки, а не ответ схемы.
    {
      body: t.Object({
        subject_type: t.Optional(t.Any()),
        subject_id: t.Optional(t.Any()),
        reason: t.Optional(t.Any()),
      }),
    }
  );
