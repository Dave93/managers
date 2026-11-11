import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { now } from "../clock";
import { dayOffEmployees, dayOffForm } from "../days-off";
import { run } from "../errors";
import { collectDeliveries } from "../notify";
import type { ItemInput } from "../reviews";
import { kpiTgCtx } from "../tg-app/ctx";
import { evaluatorActor } from "../tg-app/ev-actor";
import { evDisputeDetail, evDisputes, evResolve } from "../tg-app/ev-disputes";
import { evCard } from "../tg-app/ev-card";
import { evEmployees } from "../tg-app/ev-list";
import { evCancelDayOff, evDaysOff, evGiveDaysOff } from "../tg-app/ev-days-off";
import { evForm, evSaveDraft, evSubmit } from "../tg-app/ev-review";
import type {
  EvCard,
  EvDayOff,
  EvDayOffEmployees,
  EvDayOffForm,
  EvDaysOff,
  EvDaysOffCreated,
  EvDispute,
  EvDisputeDetail,
  EvDisputes,
  EvEmployees,
  EvReviewForm,
  EvViolation,
  EvViolationForm,
  EvViolations,
} from "../tg-app/ev-types";
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
  // Карточка сотрудника: справка оценщику. id и period проверяет сервис: не uuid, чужой и несуществующий — 404 not_found.
  .get(
    "/kpi/tg/ev/employees/:id/card",
    async ({ params, query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvCard> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evCard(drizzle, actor, params.id, query.period);
      }),
    { params: t.Object({ id: t.String() }), query: t.Object({ period: t.Optional(t.Any()) }) }
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
  )
  // status проверяет listDisputes: мусор — наш 422 bad_status, а не ответ схемы.
  .get(
    "/kpi/tg/ev/disputes",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDisputes> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evDisputes(drizzle, actor, query.status);
      }),
    { query: t.Object({ status: t.Optional(t.Any()) }) }
  )
  // Чужой спор и несуществующий (в том числе не uuid) — один и тот же 404 not_found.
  .get(
    "/kpi/tg/ev/disputes/:id",
    async ({ params, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDisputeDetail> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evDisputeDetail(drizzle, actor, params.id);
      }),
    { params: t.Object({ id: t.String() }) }
  )
  // Тело как у админского POST /kpi/disputes/:id/resolve; значения проверяет resolveDispute (bad_decision, comment_required, ...).
  .post(
    "/kpi/tg/ev/disputes/:id/resolve",
    async ({ params, body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDispute> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evResolve(drizzle, actor, params.id, {
          decision: body.decision,
          comment: body.comment,
          items: body.items as ItemInput[] | undefined,
        });
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        decision: t.Optional(t.Any()),
        comment: t.Optional(t.Any()),
        items: t.Optional(itemsSchema),
      }),
    }
  )
  // employee_id проверяет сервис: не uuid (в том числе без параметра) или нет такого сотрудника — 404 not_found.
  .get(
    "/kpi/tg/ev/day-off-form",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDayOffForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return dayOffForm(drizzle, actor, query.employee_id, now());
      }),
    { query: t.Object({ employee_id: t.Optional(t.Any()) }) }
  )
  // Поля без схемных проверок: неверное значение — наш код ошибки (bad_id, bad_dates, bad_reason, ...), а не ответ схемы.
  .post(
    "/kpi/tg/ev/days-off",
    async ({ body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDaysOffCreated> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return collectDeliveries(() => evGiveDaysOff(drizzle, actor, body, now()));
      }),
    {
      body: t.Object({
        employee_id: t.Optional(t.Any()),
        from: t.Optional(t.Any()),
        to: t.Optional(t.Any()),
        reason_code: t.Optional(t.Any()),
        reason_text: t.Optional(t.Any()),
        request_replacement: t.Optional(t.Any()),
      }),
    }
  )
  // Сотрудники филиалов оценщика для выбора, кому выдать выходной: с картой и без.
  .get("/kpi/tg/ev/days-off/employees", async ({ tg, drizzle, cacheController, set }) =>
    run(set, async (): Promise<EvDayOffEmployees> => {
      const actor = await evaluatorActor(drizzle, cacheController, tg);
      return dayOffEmployees(drizzle, actor);
    })
  )
  // period проверяет сервис: кривой — наш 422 bad_period; без period — месяц момента запроса.
  .get(
    "/kpi/tg/ev/days-off",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDaysOff> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evDaysOff(drizzle, actor, query.period, now());
      }),
    { query: t.Object({ period: t.Optional(t.Any()) }) }
  )
  .post(
    "/kpi/tg/ev/days-off/:id/cancel",
    async ({ params, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvDayOff> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evCancelDayOff(drizzle, actor, params.id);
      }),
    { params: t.Object({ id: t.String() }) }
  );
