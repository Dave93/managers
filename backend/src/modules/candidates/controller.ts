import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { candidates, vacancy } from "backend/drizzle/schema";
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

type CandidateInsert = typeof candidates.$inferInsert;
type ErrorResponse = { message: string; stack?: string };
type ResultStatus = "positive" | "negative" | "neutral" | null;

export const candidatesController = new Elysia({
    name: "@api/candidates",
})
    .use(ctx)
    .get("/candidates", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle}) => {
        try {
            let selectFields: SelectedFields = {
                id: candidates.id,
                vacancyId: candidates.vacancyId,
                fullName: candidates.fullName,
                phoneNumber: candidates.phoneNumber,
                email: candidates.email,
                citizenship: candidates.citizenship,
                residence: candidates.residence,
                passportNumber: candidates.passportNumber,
                passportSeries: candidates.passportSeries,
                passportIdDate: candidates.passportIdDate,
                passportIdPlace: candidates.passportIdPlace,
                source: candidates.source,
                familyStatus: candidates.familyStatus,
                children: candidates.children,
                language: candidates.language,
                strengthsShortage: candidates.strengthsShortage,
                relatives: candidates.relatives,
                desiredSalary: candidates.desiredSalary,
                desiredSchedule: candidates.desiredSchedule,
                purpose: candidates.purpose,
                desiredPosition: candidates.desiredPosition,
                resultStatus: candidates.resultStatus,
                createdAt: candidates.createdAt,
                updatedAt: candidates.updatedAt,
            };

            if (fields) {
                selectFields = parseSelectFields(fields, candidates, {
                    vacancy: vacancy,
                });
            }

            let whereClause: (SQLWrapper | undefined)[] = [];
            if (filters) {
                whereClause = parseFilterFields(filters, candidates, {
                    vacancy: vacancy,
                });
            }

            const candidatesCount = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(candidates)
                .leftJoin(vacancy, eq(vacancy.id, candidates.vacancyId))
                .where(and(...whereClause))
                .execute();

            const candidatesList = await drizzle
                .select(selectFields)
                .from(candidates)
                .leftJoin(vacancy, eq(vacancy.id, candidates.vacancyId))
                .where(and(...whereClause))
                .limit(limit ? Number(limit) : 50)
                .offset(offset ? Number(offset) : 0)
                .execute();

            return {
                total: candidatesCount[0].count,
                data: candidatesList,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to fetch candidates",
                message: err.message
            };
        }
    }, {
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })

    .post("/candidates", async ({ body, user, set, drizzle, cacheController }) => {
        try {
            const candidateData: CandidateInsert = {
                ...body,
                desiredSalary: body.desiredSalary ? Number(body.desiredSalary) : null,
                resultStatus: (body.resultStatus as ResultStatus) || null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            
            const candidate = await drizzle
                .insert(candidates)
                .values(candidateData)
                .execute();
            
            await cacheController.cachePermissions();
            return {
                data: candidate,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to create candidate",
                message: err.message
            };
        }
    }, {
        permission: "candidates.add",
        body: t.Object({
            vacancyId: t.String(),
            fullName: t.String(),
            phoneNumber: t.String(),
            email: t.String(),
            citizenship: t.String(),
            residence: t.String(),
            passportNumber: t.String(),
            passportSeries: t.String(),
            passportIdDate: t.String(),
            passportIdPlace: t.String(),
            source: t.String(),
            familyStatus: t.String(),
            children: t.Number(),
            language: t.String(),
            strengthsShortage: t.Optional(t.String()),
            relatives: t.Optional(t.String()),
            desiredSalary: t.Optional(t.String()),
            desiredSchedule: t.Optional(t.String()),
            purpose: t.Optional(t.String()),
            desiredPosition: t.Optional(t.String()),
            resultStatus: t.Optional(t.Enum({ positive: "positive", negative: "negative", neutral: "neutral" }))
        })
    })

    .put("/candidates/:id", async ({ params: { id }, body, user, set, drizzle, cacheController }) => {
        try {
            const updateData = {
                ...body,
                desiredSalary: body.desiredSalary ? Number(body.desiredSalary) : undefined,
                resultStatus: body.resultStatus as ResultStatus | undefined,
                updatedAt: new Date(),
            };

            const candidate = await drizzle
                .update(candidates)
                .set(updateData)
                .where(eq(candidates.id, id))
                .returning()
                .execute();

            if (!candidate.length) {
                set.status = 404;
                return {
                    error: "Candidate not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: candidate[0],
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to update candidate",
                message: err.message
            };
        }
    }, {
        permission: "candidates.edit",
        params: t.Object({
            id: t.String(),
        }),
        body: t.Object({
            vacancyId: t.String(),
            fullName: t.String(),
            phoneNumber: t.String(),
            email: t.Optional(t.String()),
            citizenship: t.Optional(t.String()),
            residence: t.Optional(t.String()),
            passportNumber: t.Optional(t.String()),
            passportSeries: t.Optional(t.String()),
            passportIdDate: t.Optional(t.String()),
            passportIdPlace: t.Optional(t.String()),
            source: t.Optional(t.String()),
            familyStatus: t.Optional(t.String()),
            children: t.Optional(t.Number()),
            language: t.Optional(t.String()),
            strengthsShortage: t.Optional(t.String()),
            relatives: t.Optional(t.String()),
            desiredSalary: t.Optional(t.String()),
            desiredSchedule: t.Optional(t.String()),
            purpose: t.Optional(t.String()),
            desiredPosition: t.Optional(t.String()),
            resultStatus: t.Optional(t.Enum({ positive: "positive", negative: "negative", neutral: "neutral" }))
        })
    })

    .delete("/candidates/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
        try {
            const candidate = await drizzle
                .delete(candidates)
                .where(eq(candidates.id, id))
                .returning()
                .execute();

            if (!candidate.length) {
                set.status = 404;
                return {
                    error: "Candidate not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: candidate[0],
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to delete candidate",
                message: err.message
            };
        }
    }, {
        permission: "candidates.delete",
        params: t.Object({
            id: t.String(),
        })
    }) 