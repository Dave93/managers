import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { candidates, education, vacancy } from "backend/drizzle/schema"
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";

type EducationInsert = typeof education.$inferInsert;
type ErrorResponse = { message: string; stack?: string };
type Education = typeof education.$inferSelect;

export const educationController = new Elysia({
    name: "@api/education"
})
    .use(ctx)
    .get("/education", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => { 

        try {
            let selectFields: SelectedFields = {
                id: education.id,
                candidateId: education.candidateId,
                dateStart: education.dateStart,
                dateEnd: education.dateEnd,
                educationType: education.educationType,
                university: education.university,
                speciality: education.speciality,
            };

            if (fields) {
                selectFields = parseSelectFields(fields, education, {
                    vacancy: vacancy,
                    
                });
            }

            let whereClause: (SQLWrapper | undefined)[] = [];
            if (filters) {
                whereClause = parseFilterFields(filters, education, {
                    vacancy: vacancy,
                });
            }

            const educationCount = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(education)
                .leftJoin(candidates, eq(candidates.id, education.candidateId))
                .where(and(...whereClause))
                .execute();

            const educationList = await drizzle
                .select(selectFields)
                .from(education)
                .leftJoin(candidates, eq(candidates.id, education.candidateId))
                .where(and(...whereClause))
                .execute();

            return {
                total: educationCount[0].count,
                data: educationList,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to fetch education",
                message: err.message
            };
        }   
    }, {
        permission: "education.list",
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })

    .post("/education", async ({ body, user, set, drizzle, cacheController }) => {
        try {
            console.log('Received education data:', body);

            // Проверяем обязательные поля
            if (!body.candidateId) {
                console.error('Missing required field: candidateId');
                set.status = 400;
                return {
                    error: "Missing required field",
                    message: "candidateId is required"
                };
            }

            if (!body.dateStart || !body.dateEnd) {
                console.error('Missing required fields: dates', { dateStart: body.dateStart, dateEnd: body.dateEnd });
                set.status = 400;
                return {
                    error: "Missing required fields",
                    message: "dateStart and dateEnd are required"
                };
            }

            // Проверка на существование кандидата
            const candidateExists = await drizzle
                .select({ id: candidates.id })
                .from(candidates)
                .where(eq(candidates.id, body.candidateId))
                .execute();

            if (!candidateExists.length) {
                console.error('Invalid candidateId: candidate not found', { candidateId: body.candidateId });
                set.status = 400;
                return {
                    error: "Invalid candidateId",
                    message: "Candidate not found"
                };
            }

            // Форматируем и проверяем даты
            try {
                const dateStart = new Date(body.dateStart);
                const dateEnd = new Date(body.dateEnd);

                if (isNaN(dateStart.getTime()) || isNaN(dateEnd.getTime())) {
                    console.error('Invalid date format', { dateStart: body.dateStart, dateEnd: body.dateEnd });
                    set.status = 400;
                    return {
                        error: "Invalid date format",
                        message: "dateStart and dateEnd must be valid dates"
                    };
                }

                if (dateEnd < dateStart) {
                    console.error('Invalid date range: end date before start date', { dateStart, dateEnd });
                    set.status = 400;
                    return {
                        error: "Invalid date range",
                        message: "dateEnd cannot be before dateStart"
                    };
                }

                const educationData = {
                    ...body,
                    dateStart: dateStart.toISOString(),
                    dateEnd: dateEnd.toISOString(),
                };

                console.log('Formatted education data:', educationData);
                
                const [newEducation] = await drizzle
                    .insert(education)
                    .values(educationData)
                    .returning({
                        id: education.id,
                        candidateId: education.candidateId,
                        dateStart: education.dateStart,
                        dateEnd: education.dateEnd,
                        educationType: education.educationType,
                        university: education.university,
                        speciality: education.speciality,
                    })
                    .execute();
                
                console.log('Created education:', newEducation);
                
                if (!newEducation) {
                    throw new Error('Failed to create education record');
                }

                await cacheController.cachePermissions();
                return {
                    data: [newEducation]
                };
            } catch (dateError: any) {
                console.error('Date processing error:', dateError);
                set.status = 400;
                return {
                    error: "Date processing error",
                    message: dateError.message || "Invalid date format"
                };
            }
        } catch (error: any) {
            console.error('Error in education creation:', {
                message: error?.message || 'Unknown error',
                stack: error?.stack || 'No stack trace',
                body: body
            });
            set.status = 500;
            return {
                error: "Failed to create education",
                message: error?.message || 'Unknown error'
            };
        }
    }, {
        permission: "education.add",
        body: t.Object({
            candidateId: t.String(),
            dateStart: t.String(),
            dateEnd: t.String(),
            educationType: t.String(),
            university: t.String(),
            speciality: t.String()
        })
    })

    .put("/education/:id", async ({ params: { id }, body, user, set, drizzle, cacheController }) => { 
        try {
            const updateData = {
                ...body,
                dateStart: body.dateStart ? new Date(body.dateStart).toISOString() : undefined,
                dateEnd: body.dateEnd ? new Date(body.dateEnd).toISOString() : undefined,
                updatedAt: new Date().toISOString(),
            };

            const educations = await drizzle
                .update(education)
                .set(updateData)
                .where(eq(education.id, id))
                .returning()
                .execute();

            if (!educations.length) {
                set.status = 404;
                return {
                    error: "Education not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: educations,
            };
        } catch (error) {
            const err = error as ErrorResponse;
        }
    }, {
        permission: "education.edit",
        params: t.Object({
            id: t.String(),
        }),
        body: t.Object({
            candidateId: t.Optional(t.String()),
            dateStart: t.Optional(t.String()),
            dateEnd: t.Optional(t.String()),
            educationType: t.Optional(t.String()),
            university: t.Optional(t.String()),
            speciality: t.Optional(t.String())
        })
    })

    .delete("/education/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
        try {
            const educations = await drizzle
                .delete(education)
                .where(eq(education.id, id))
                .returning()
                .execute();

            if (!educations.length) {
                set.status = 404;
                return {
                    error: "Education not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: education,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to delete education",
                message: err.message
            };
        }
    }, {
        permission: "education.delete",
        params: t.Object({
            id: t.String(),
        })
    })