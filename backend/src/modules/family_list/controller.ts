// src/modules/family_List/controller.ts

import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { candidates, family_list} from "backend/drizzle/schema"
import { and, desc, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";

type ErrorResponse = { message: string; stack?: string };
type FamilyList = typeof family_list.$inferSelect;

export const familyListController = new Elysia({
    name: "@api/family_list"
})
    .use(ctx)
    .get("/family-list", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        try {
            let selectFields: SelectedFields = {
                id: family_list.id,
                candidateId: family_list.candidateId,
                familyListName: family_list.familyListName,
                familyListBirthDate: family_list.familyListBirthDate,
                familyListPhone: family_list.familyListPhone,
                familyListRelation: family_list.familyListRelation,
                familyListAddress: family_list.familyListAddress,
                familyJob: family_list.familyJob
            };


            if (fields) {
                selectFields = parseSelectFields(fields, family_list, {
                    candidate: candidates,
                });
            }

            let whereClause: (SQLWrapper | undefined)[] = [];
            if (filters) {
                whereClause = parseFilterFields(filters, family_list, {
                    candidate: candidates,
                });
            }

            const familyListCount = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(family_list)
                .leftJoin(candidates, eq(candidates.id, family_list.candidateId))
                .where(and(...whereClause))
                .execute();

            const familyListList = await drizzle
                .select(selectFields)
                .from(family_list)
                .leftJoin(candidates, eq(candidates.id, family_list.candidateId))
                .where(and(...whereClause))
                .execute();

            return {
                total: familyListCount[0].count,
                data: familyListList,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to fetch family list",
                message: err.message
            };
        }   
    }, {
        permission: "family_list.list",
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })

    .post("/family-list", async ({ body, user, set, drizzle }) => {
        try {
            const { candidateId, familyListName, familyListBirthDate, familyListPhone, familyListRelation, familyListAddress, familyJob } = body;

            const familyList = await drizzle.insert(family_list).values({
                candidateId,    
                familyListName,
                familyListBirthDate,
                familyListPhone,
                familyListRelation,
                familyListAddress,
                familyJob
            }); 

            return {
                data: familyList,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to create family list",
                message: err.message
            };
        }
    }, {
        permission: "family_list.add",
        body: t.Object({
            candidateId: t.String(),
            familyListName: t.String(),
            familyListBirthDate: t.String(),
            familyListPhone: t.String(),
            familyListRelation: t.String(),
            familyListAddress: t.String(),
            familyJob: t.String()
        })
    })

    .put("/family-list/:id", async ({ params: { id }, body, user, set, drizzle }) => {
        try {
            const { candidateId, familyListName, familyListBirthDate, familyListPhone, familyListRelation, familyListAddress, familyJob } = body;

            const familyList = await drizzle.update(family_list)
                .set({
                    candidateId,
                    familyListName,
                    familyListBirthDate,
                    familyListPhone,
                    familyListRelation,     
                    familyListAddress,
                    familyJob
                })
                .where(eq(family_list.id, id))
                .returning();

            return {            
                data: familyList,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to update family list",      
                message: err.message
            };
        }
    }, {
        permission: "family_list.edit",
        params: t.Object({
            id: t.String(),
        }), 
        body: t.Object({
            candidateId: t.String(),
            familyListName: t.String(),
            familyListBirthDate: t.String(),
            familyListPhone: t.String(),
            familyListRelation: t.String(),
            familyListAddress: t.String(),
            familyJob: t.String()
        })
    })
    
    .delete("/family-list/:id", async ({ params: { id }, user, set, drizzle }) => {
        try {
            await drizzle.delete(family_list)
                .where(eq(family_list.id, id));

            return {
                message: "Family list deleted successfully",
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to delete family list",
                message: err.message
            };
        }
    }, {
        permission: "family_list.delete",
        params: t.Object({
            id: t.String(),
        })
    })