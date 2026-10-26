import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { KpiError, run } from "../errors";
import { setLang } from "../tg/bindings";
import { authenticate } from "../tg-app/auth";
import { kpiTgCtx } from "../tg-app/ctx";
import type { TgLangResponse } from "../tg-app/types";

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
        // Кнопку меню здесь не трогаем (задача 6). null — привязки сняли между guard и записью: сессии больше нет.
        if (!(await setLang(drizzle, tg.telegram_id, lang))) throw new KpiError(401, "unauthorized");
        return { lang };
      }),
    { body: t.Object({ lang: t.Optional(t.Any()) }) }
  );
