import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { positions, terminals } from "backend/drizzle/schema";
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

// Добавляем функцию для отладки
const debugLog = (message: string, data: any) => {
  console.log(`[PositionsController] ${message}:`, data);
};

export const positionsController = new Elysia({
  name: "@api/positions",
})
  .use(ctx)
  .get("/positions", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
    debugLog("GET /positions query params", { limit, offset, sort, filters, fields });
    
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
      debugLog("Parsing filters", filters);
      try {
        const parsedFilters = JSON.parse(filters);
        debugLog("Parsed filters", parsedFilters);
        
        // Поддержка как массива фильтров, так и объекта с прямыми значениями
        if (Array.isArray(parsedFilters)) {
          whereClause = parseFilterFields(filters, positions, {
            terminal: terminals,
          });
        } else if (typeof parsedFilters === 'object') {
          // Преобразуем объект в формат массива фильтров
          const filtersArray = Object.entries(parsedFilters).map(([field, value]) => ({
            field,
            operator: "=",
            value
          }));
          debugLog("Converted filters to array format", filtersArray);
          whereClause = parseFilterFields(JSON.stringify(filtersArray), positions, {
            terminal: terminals,
          });
        }
      } catch (error) {
        debugLog("Error parsing filters", error);
        whereClause = parseFilterFields(filters, positions, {
          terminal: terminals,
        });
      }
    }

    debugLog("Where clause", whereClause);

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

    debugLog("Positions list count", positionsList.length);
    
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

  .get("/positions/:id", async ({ params: { id }, user, set, drizzle }) => {
    console.log("GET /positions/:id", { id });
    
    const position = await drizzle
      .select({
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
      })
      .from(positions)
      .leftJoin(terminals, eq(positions.terminalId, terminals.id))
      .where(eq(positions.id, id))
      .execute();
    
    console.log("Position found by ID", position[0] || null);
    
    if (position.length === 0) {
      set.status = 404;
      return {
        error: "Position not found"
      };
    }
    
    return position[0];
  },
  {
    permission: "positions.list",
    params: t.Object({
      id: t.String(),
    }),
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