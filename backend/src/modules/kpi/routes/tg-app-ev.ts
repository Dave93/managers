import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { now } from "../clock";
import { run } from "../errors";
import type { ItemInput } from "../reviews";
import { kpiTgCtx } from "../tg-app/ctx";
import { evaluatorActor } from "../tg-app/ev-actor";
import { evEmployees } from "../tg-app/ev-list";
import { evForm, evSaveDraft, evSubmit } from "../tg-app/ev-review";
import type { EvEmployees, EvReviewForm, EvViolation, EvViolationForm, EvViolations } from "../tg-app/ev-types";
import { evCancelViolation, evCreateViolation, evViolationForm, evViolations } from "../tg-app/ev-violations";
import { normalizePhotos, photoFile } from "../violations";
import { itemsSchema } from "./reviews";

// Роуты оценщика в мини-приложении «Мой KPI» (/kpi/tg/ev/*). Тот же Bearer-guard kpiTgCtx, что у tgAppRoutes:
// он подключён после .use(ctx) и действует только на роуты, объявленные ниже.
// Каждый обработчик строит Actor по сессии (evaluatorActor) внутри run(): отказ — наш 403, а не 500.
export const tgAppEvRoutes = new Elysia({ name: "@api/kpi/tg-app-ev" })
  .use(ctx)
  .use(kpiTgCtx)
  // period проверяет сервис: кривой — наш 422 bad_period, а не ответ схемы.
  .get(
    "/kpi/tg/ev/employees",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvEmployees> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evEmployees(drizzle, actor, query.period, now());
      }),
    { query: t.Object({ period: t.Optional(t.Any()) }) }
  )
  // period и employee_id проверяет сервис: мусор — наш 422 bad_period / bad_id, а не ответ схемы.
  .get(
    "/kpi/tg/ev/form",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvReviewForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evForm(drizzle, actor, query.period, query.employee_id);
      }),
    { query: t.Object({ period: t.Optional(t.Any()), employee_id: t.Optional(t.Any()) }) }
  )
  .put(
    "/kpi/tg/ev/draft",
    async ({ body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvReviewForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evSaveDraft(drizzle, actor, body);
      }),
    {
      body: t.Object({
        period: t.Optional(t.Any()),
        employee_id: t.Optional(t.Any()),
        items: t.Optional(itemsSchema),
      }),
    }
  )
  .post(
    "/kpi/tg/ev/reviews/:id/submit",
    async ({ params, body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvReviewForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evSubmit(drizzle, actor, params.id, (body?.items ?? undefined) as ItemInput[] | undefined);
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ items: t.Optional(itemsSchema) })),
    }
  )
  // employee_id проверяет сервис: не uuid (в том числе без параметра) или нет такого сотрудника — 404 not_found.
  .get(
    "/kpi/tg/ev/violation-form",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvViolationForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evViolationForm(drizzle, actor, query.employee_id);
      }),
    { query: t.Object({ employee_id: t.Optional(t.Any()) }) }
  )
  // Тело как у админского POST /kpi/violations, но без occurred_at: нарушение пишется текущим временем (решение плана 6).
  // Поля без схемных проверок: неверное значение — наш код ошибки, а не ответ схемы.
  .post(
    "/kpi/tg/ev/violations",
    async ({ body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvViolation> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evCreateViolation(drizzle, actor, {
          employee_id: body.employee_id,
          card_item_id: body.card_item_id,
          comment: body.comment,
          photos: normalizePhotos(body.photos),
        });
      }),
    {
      type: "multipart/form-data",
      body: t.Object({
        employee_id: t.Optional(t.String()),
        card_item_id: t.Optional(t.String()),
        comment: t.Optional(t.String()),
        photos: t.Optional(t.Any()),
      }),
    }
  )
  // period проверяет сервис: кривой — наш 422 bad_period; без period — месяц момента запроса.
  .get(
    "/kpi/tg/ev/violations",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvViolations> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evViolations(drizzle, actor, query.period, now());
      }),
    { query: t.Object({ period: t.Optional(t.Any()) }) }
  )
  .post(
    "/kpi/tg/ev/violations/:id/cancel",
    async ({ params, body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvViolation> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evCancelViolation(drizzle, actor, params.id, body.reason);
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.Optional(t.Any()) }),
    }
  )
  // Файл отдаёт photoFile: чужое и несуществующее фото неотличимы (404 not_found). Заголовки как у админского роута.
  .get(
    "/kpi/tg/ev/violation-photos/:id/file",
    async ({ params, tg, drizzle, cacheController, set }) => {
      const r = await run(set, async () => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return photoFile(drizzle, actor, params.id);
      });
      if ("error" in r) return r;
      set.headers["content-type"] = r.mime;
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["cache-control"] = "private, max-age=3600";
      return Bun.file(r.path);
    },
    { params: t.Object({ id: t.String() }) }
  );
