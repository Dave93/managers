//* Контроллер для работы с последним местом работы

import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { candidates, last_work_place, vacancy } from "backend/drizzle/schema"
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";

type LastWorkPlaceInsert = typeof last_work_place.$inferInsert;
type ErrorResponse = { message: string; stack?: string };
type LastWorkPlace = typeof last_work_place.$inferSelect;

export const lastWorkPlaceController = new Elysia({
    name: "@api/last_work_place"
})
    .use(ctx)
    .get("/last_work_place", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => { 
        try {
            let selectFields: SelectedFields = {
                id: last_work_place.id,
                candidateId: last_work_place.candidateId,
                lastWorkPlace: last_work_place.lastWorkPlace,
                dismissalDate: last_work_place.dismissalDate,
                employmentDate: last_work_place.employmentDate,
                experience: last_work_place.experience,
                organizationName: last_work_place.organizationName,
                position: last_work_place.position,
                addressOrg: last_work_place.addressOrg,
                dismissalReason: last_work_place.dismissalReason,
            };

            if (fields) {
                selectFields = parseSelectFields(fields, last_work_place, {
                    vacancy: vacancy,
                });
            }

            let whereClause: (SQLWrapper | undefined)[] = [];
            if (filters) {
                whereClause = parseFilterFields(filters, last_work_place, {
                    vacancy: vacancy,
                });
            }

            const lastWorkPlaceCount = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(last_work_place)
                .leftJoin(candidates, eq(candidates.id, last_work_place.candidateId))
                .where(and(...whereClause))
                .execute();

            const lastWorkPlaceList = await drizzle
                .select(selectFields)
                .from(last_work_place)
                .leftJoin(candidates, eq(candidates.id, last_work_place.candidateId))
                .where(and(...whereClause))
                .execute();

            return {
                total: lastWorkPlaceCount[0].count,
                data: lastWorkPlaceList,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to fetch last work places",
                message: err.message
            };
        }   
    }, {
        permission: "last_work_place.list",
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })

    .post("/last_work_place", async ({ body, user, set, drizzle, cacheController }) => {
        try {
            console.log('Received last work place data:', body);

            // Проверяем обязательные поля
            if (!body.candidateId) {
                console.error('Missing required field: candidateId');
                set.status = 400;
                return {
                    error: "Missing required field",
                    message: "candidateId is required"
                };
            }

            if (!body.employmentDate || !body.dismissalDate) {
                console.error('Missing required fields: dates', { employmentDate: body.employmentDate, dismissalDate: body.dismissalDate });
                set.status = 400;
                return {
                    error: "Missing required fields",
                    message: "employmentDate and dismissalDate are required"
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
                const employmentDate = new Date(body.employmentDate);
                const dismissalDate = new Date(body.dismissalDate);

                if (isNaN(employmentDate.getTime()) || isNaN(dismissalDate.getTime())) {
                    console.error('Invalid date format', { employmentDate: body.employmentDate, dismissalDate: body.dismissalDate });
                    set.status = 400;
                    return {
                        error: "Invalid date format",
                        message: "employmentDate and dismissalDate must be valid dates"
                    };
                }

                if (dismissalDate < employmentDate) {
                    console.error('Invalid date range: dismissal date before employment date', { employmentDate, dismissalDate });
                    set.status = 400;
                    return {
                        error: "Invalid date range",
                        message: "dismissalDate cannot be before employmentDate"
                    };
                }

                const lastWorkPlaceData = {
                    ...body,
                    employmentDate: employmentDate.toISOString(),
                    dismissalDate: dismissalDate.toISOString(),
                };

                console.log('Formatted last work place data:', lastWorkPlaceData);
                
                const [newLastWorkPlace] = await drizzle
                    .insert(last_work_place)
                    .values(lastWorkPlaceData)
                    .returning({
                        id: last_work_place.id,
                        candidateId: last_work_place.candidateId,
                        lastWorkPlace: last_work_place.lastWorkPlace,
                        dismissalDate: last_work_place.dismissalDate,
                        employmentDate: last_work_place.employmentDate,
                        experience: last_work_place.experience,
                        organizationName: last_work_place.organizationName,
                        position: last_work_place.position,
                        addressOrg: last_work_place.addressOrg,
                        dismissalReason: last_work_place.dismissalReason,
                    })
                    .execute();
                
                console.log('Created last work place:', newLastWorkPlace);
                
                if (!newLastWorkPlace) {
                    throw new Error('Failed to create last work place record');
                }

                await cacheController.cachePermissions();
                return {
                    data: [newLastWorkPlace]
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
            console.error('Error in last work place creation:', {
                message: error?.message || 'Unknown error',
                stack: error?.stack || 'No stack trace',
                body: body
            });
            set.status = 500;
            return {
                error: "Failed to create last work place",
                message: error?.message || 'Unknown error'
            };
        }
    }, {
        permission: "last_work_place.add",
        body: t.Object({
            candidateId: t.String(),
            lastWorkPlace: t.Optional(t.String()),
            dismissalDate: t.String(),
            employmentDate: t.String(),
            experience: t.Optional(t.String()),
            organizationName: t.String(),
            position: t.String(),
            addressOrg: t.Optional(t.String()),
            dismissalReason: t.Optional(t.String())
        })
    })

    .put("/last_work_place/:id", async ({ params: { id }, body, user, set, drizzle, cacheController }) => { 
        try {
            const updateData = {
                ...body,
                employmentDate: body.employmentDate ? new Date(body.employmentDate).toISOString() : undefined,
                dismissalDate: body.dismissalDate ? new Date(body.dismissalDate).toISOString() : undefined,
                updatedAt: new Date().toISOString(),
            };

            const lastWorkPlaces = await drizzle
                .update(last_work_place)
                .set(updateData)
                .where(eq(last_work_place.id, id))
                .returning()
                .execute();

            if (!lastWorkPlaces.length) {
                set.status = 404;
                return {
                    error: "Last work place not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: lastWorkPlaces,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to update last work place",
                message: err.message
            };
        }
    }, {
        permission: "last_work_place.edit",
        params: t.Object({
            id: t.String(),
        }),
        body: t.Object({
            candidateId: t.Optional(t.String()),
            lastWorkPlace: t.Optional(t.String()),
            dismissalDate: t.Optional(t.String()),
            employmentDate: t.Optional(t.String()),
            experience: t.Optional(t.String()),
            organizationName: t.Optional(t.String()),
            position: t.Optional(t.String()),
            addressOrg: t.Optional(t.String()),
            dismissalReason: t.Optional(t.String())
        })
    })

    .delete("/last_work_place/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
        try {
            const lastWorkPlaces = await drizzle
                .delete(last_work_place)
                .where(eq(last_work_place.id, id))
                .returning()
                .execute();

            if (!lastWorkPlaces.length) {
                set.status = 404;
                return {
                    error: "Last work place not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: lastWorkPlaces,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to delete last work place",
                message: err.message
            };
        }
    }, {
        permission: "last_work_place.delete",
        params: t.Object({
            id: t.String(),
        })
    })