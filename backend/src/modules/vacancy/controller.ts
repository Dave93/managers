import Elysia, { t } from "elysia";
import { ctx } from "@backend/context";
import { organization, positions, terminals, users, vacancy, work_schedules } from "backend/drizzle/schema";
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseFilterFields } from "@backend/lib/parseFilterFields";

type VacancyInsert = typeof vacancy.$inferInsert;

export const vacancyController = new Elysia({
    name: "@api/vacancy",
})

    .use(ctx)

    .get("/vacancy", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        let selectFields: SelectedFields = {
            id: vacancy.id,
            applicationNum: vacancy.applicationNum,
            organizationId: vacancy.organizationId,
            organization: organization.name,
            terminalId: vacancy.terminalId,
            terminal: terminals.name,
            position: vacancy.position,
            positionTitle: positions.title,
            workScheduleId: vacancy.work_schedule_id,
            workSchedule: work_schedules.name,
            reason: vacancy.reason,
            openDate: vacancy.openDate,
            closingDate: vacancy.closingDate,
            termClosingDate: vacancy.termClosingDate,
            recruiter: vacancy.recruiter,
            recruiterName: users.first_name,
            recruiterLastName: users.last_name,
            internshipDate: vacancy.internshipDate,
            comments: vacancy.comments,
            status: vacancy.status,
            createdAt: vacancy.createdAt,
            updatedAt: vacancy.updatedAt,
        };

        if (fields) {
            selectFields = parseSelectFields(fields, vacancy, {
                terminal: terminals,
                organization: organization,
                user: users,
                work_schedule: work_schedules,
                position: positions,
            });
        }

        

        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, vacancy, {
                terminal: terminals,
                organization: organization,
                user: users,
                work_schedule: work_schedules,
                position: positions,
            });
        }

        const vacancyCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(vacancy)
            .leftJoin(terminals, eq(terminals.id, vacancy.terminalId))
            .leftJoin(organization, eq(organization.id, vacancy.organizationId))
            .leftJoin(users, eq(users.id, vacancy.recruiter))
            .leftJoin(positions, eq(positions.id, vacancy.position))
            .leftJoin(work_schedules, eq(work_schedules.id, vacancy.work_schedule_id))
            .where(and(...whereClause))
            .execute();

        const vacancyList = await drizzle
            .select(selectFields)
            .from(vacancy)
            .leftJoin(terminals, eq(terminals.id, vacancy.terminalId))
            .leftJoin(organization, eq(organization.id, vacancy.organizationId))
            .leftJoin(users, eq(users.id, vacancy.recruiter))
            .leftJoin(positions, eq(positions.id, vacancy.position))
            .leftJoin(work_schedules, eq(work_schedules.id, vacancy.work_schedule_id))
            .where(and(...whereClause))
            .limit(limit ? Number(limit) : 50)
            .offset(offset ? Number(offset) : 0)
            .execute();

        return {
            total: vacancyCount[0].count,
            data: vacancyList,
        };
    },
        {
            permission: "vacancy.list",
            query: t.Object({
                limit: t.String(),
                offset: t.String(), 
                filters: t.Optional(t.String()),
                fields: t.Optional(t.String()),
                sort: t.Optional(t.String()),
            }),
        })
  
    

    .post("/vacancy", async ({ body: { data }, user, set, drizzle, cacheController }) => {
        const insertData: VacancyInsert = {
            ...data,
            work_schedule_id: data.workScheduleId,
            openDate: data.openDate ? new Date(new Date(data.openDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : new Date().toISOString(),
            closingDate: data.closingDate ? new Date(new Date(data.closingDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            termClosingDate: data.termClosingDate ? new Date(new Date(data.termClosingDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            internshipDate: data.internshipDate ? new Date(new Date(data.internshipDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            status: data.status as "open" | "in_progress" | "found_candidates" | "interview" | "closed" | "cancelled" | null | undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const vacancys = await drizzle
            .insert(vacancy)
            .values(insertData)
            .execute();

        await cacheController.cachePermissions();
        return {
            data: vacancy,
        };
    },
        {
            permission: "vacancy.add",
            body: t.Object({
                data: t.Object({
                    applicationNum: t.String(),
                    organizationId: t.Optional(t.String()),
                    terminalId: t.Optional(t.String()),
                    position: t.String(),
                    workScheduleId: t.Optional(t.String()),
                    reason: t.String(),
                    openDate: t.String(),
                    closingDate: t.Optional(t.String()),
                    recruiter: t.Optional(t.String()),
                    termClosingDate: t.Optional(t.String()),
                    internshipDate: t.Optional(t.String()),
                    comments: t.Optional(t.String()),
                    status: t.Optional(t.Union([
                        t.Literal("open"),
                        t.Literal("in_progress"),
                        t.Literal("found_candidates"),
                        t.Literal("interview"),
                        t.Literal("closed"),
                        t.Literal("cancelled"),
                    ])),
                }),
            }),
        })
    .put("/vacancy/:id", async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
        const updateData = {
            ...data,
            work_schedule_id: data.workScheduleId,
            openDate: data.openDate ? new Date(new Date(data.openDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            closingDate: data.closingDate ? new Date(new Date(data.closingDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            termClosingDate: data.termClosingDate ? new Date(new Date(data.termClosingDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            internshipDate: data.internshipDate ? new Date(new Date(data.internshipDate).getTime() - 5 * 60 * 60 * 1000).toISOString() : undefined,
            updatedAt: new Date().toISOString(),
        };

        const vacancys = await drizzle
            .update(vacancy)
            .set(updateData)
            .where(eq(vacancy.id, id))
            .returning()
            .execute();
        await cacheController.cachePermissions();
        return {
            data: vacancys[0],
        };
    },
        {
            permission: "vacancy.edit",
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                data: t.Object({
                    applicationNum: t.Optional(t.String()),
                    organizationId: t.Optional(t.String()),
                    terminalId: t.Optional(t.String()),
                    position: t.Optional(t.String()),
                    workScheduleId: t.Optional(t.String()),
                    reason: t.Optional(t.String()),
                    openDate: t.Optional(t.String()),
                    closingDate: t.Optional(t.String()),
                    recruiter: t.Optional(t.String()),
                    termClosingDate: t.Optional(t.String()),
                    internshipDate: t.Optional(t.String()),
                    comments: t.Optional(t.String()),
                    status: t.Optional(t.Union([
                        t.Literal("open"),
                        t.Literal("in_progress"),
                        t.Literal("found_candidates"),
                        t.Literal("interview"),
                        t.Literal("closed"),
                        t.Literal("cancelled"),
                    ])),
                }),
            }),
        })
    .delete("/vacancy/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
        const vacancys = await drizzle
            .delete(vacancy)
            .where(eq(vacancy.id, id))
            .returning()
            .execute();
        await cacheController.cachePermissions();
        return {
            data: vacancys[0],
        };
        },
        {
            permission: "vacancy.delete",
            params: t.Object({
                id: t.String(),
            }),
        })