import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { positions, terminals } from "backend/drizzle/schema";
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const positionsController = new Elysia({
  name: "@api/positions",
})
  .use(ctx)
  .get("/positions", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
    let selectFields: SelectedFields = {
      id: positions.id,
      title: positions.title,
      description: positions.description,
      requirements: positions.requirements,
      salaryMin: positions.salaryMin,
      salaryMax: positions.salaryMax,
      terminalId: positions.terminalId,
      terminalName: terminals.name,
      createdAt: positions.createdAt,
      updatedAt: positions.updatedAt,
    };

    if (fields) {
      selectFields = parseSelectFields(fields, positions, {
        terminal: terminals,
      });
    }

    let whereClause: (SQLWrapper | undefined)[] = [];
    if (filters) {
      whereClause = parseFilterFields(filters, positions, {
        terminal: terminals,
      });
    }

    const positionsCount = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(positions)
      .leftJoin(terminals, eq(positions.terminalId, terminals.id))
      .where(and(...whereClause))
      .execute();

    const positionsList = await drizzle
      .select(selectFields)
      .from(positions)
      .leftJoin(terminals, eq(positions.terminalId, terminals.id))
      .where(and(...whereClause))
      .limit(limit ? Number(limit) : 50)
      .offset(offset ? Number(offset) : 0)
      .execute();

    return {
      total: positionsCount[0].count,
      data: positionsList,
    };
  },
  {
    permission: "positions.list",
    query: t.Object({
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      filters: t.Optional(t.String()),
      fields: t.Optional(t.String()),
    }),
  })

  .get("/positions/cached", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle, cacheController }) => {
    const positionsList = await cacheController.getCachedPositions({});

    
    return positionsList;
  },
  {
    permission: "positions.list",
  })

  .post("/positions", async ({ body: { data }, user, set, drizzle, cacheController }) => {
    const insertData = {
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const position = await drizzle
      .insert(positions)
      .values(insertData)
      .execute();
    
    await cacheController.cachePositions();
    return {
      data: position,
    };
  },
  {
    permission: "positions.add",
    body: t.Object({
      data: t.Object({
        title: t.String(),
        description: t.Optional(t.String()),
        requirements: t.Optional(t.String()),
        salaryMin: t.Optional(t.Number()),
        salaryMax: t.Optional(t.Number()),
        terminalId: t.Optional(t.String()),
      }),
    }),
  })

  .put("/positions/:id", async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
    const position = await drizzle
      .update(positions)
      .set(data)
      .where(eq(positions.id, id))
      .execute();
    await cacheController.cachePositions();
    return {
      data: position,
    };
  },
  {
    permission: "positions.edit",
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      data: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        requirements: t.Optional(t.String()),
        salaryMin: t.Optional(t.Number()),
        salaryMax: t.Optional(t.Number()),
        terminalId: t.Optional(t.String()),
      }),
    }),
  })

  .delete("/positions/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
    await drizzle
      .delete(positions)
      .where(eq(positions.id, id))
      .execute();
    await cacheController.cachePositions();
    return {
      data: true,
    };
  },
  {
    permission: "positions.delete",
    params: t.Object({
      id: t.String(),
    }),
  });