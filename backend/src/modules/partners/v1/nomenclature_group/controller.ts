import Elysia, { t } from "elysia";
import { partnersMiddleware } from "../middleware";
import { nomenclature_group } from "backend/drizzle/schema";
import { and, eq, gt, sql, SQLWrapper } from "drizzle-orm";
import { ctx } from "@backend/context";

export const partnersNomenclatureGroupController = new Elysia({
    name: "@api/partners/v1/nomenclature_group",
    tags: ["Partners Nomenclature Group"],
})
    .use(ctx)
    .get(
        "/nomenclature-groups",
        async ({ query, drizzle }) => {
            const {
                limit = "50",
                offset,
                cursor,
                parent_id,
                pagination_type = "offset",
            } = query;

            // Build where clause
            const whereConditions: SQLWrapper[] = [];

            // Add parent_id filter if provided
            if (parent_id) {
                whereConditions.push(eq(nomenclature_group.parent_id, parent_id));
            }

            // Cursor-based pagination
            if (pagination_type === "cursor" && cursor) {
                whereConditions.push(gt(nomenclature_group.id, cursor));
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination or when no cursor is provided
            let total: number | undefined;
            if (pagination_type === "offset" || !cursor) {
                const countResult = await drizzle
                    .select({ count: sql<number>`count(*)` })
                    .from(nomenclature_group)
                    .where(whereClause)
                    .execute();
                total = countResult[0].count;
            }

            // Build query based on pagination type
            let query_builder = drizzle
                .select()
                .from(nomenclature_group)
                .where(whereClause)
                .orderBy(nomenclature_group.id)
                .limit(Number(limit));

            // Add offset for offset-based pagination
            if (pagination_type === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const groupList = await query_builder.execute();

            // Prepare response
            const response: {
                data: typeof groupList;
                total?: number;
                next_cursor?: string | null;
                has_more?: boolean;
            } = {
                data: groupList,
            };

            // Add pagination metadata based on type
            if (pagination_type === "cursor") {
                response.next_cursor =
                    groupList.length === Number(limit)
                        ? groupList[groupList.length - 1].id
                        : null;
                response.has_more = groupList.length === Number(limit);
            } else {
                response.total = parseInt(total?.toString() || "0");
            }
            return response;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String({
                    default: "50",
                    description: "Number of nomenclature groups to return per page (1-100)",
                    examples: ["10", "25", "50"]
                })),
                offset: t.Optional(t.String({
                    description: "Offset for pagination (only for offset-based pagination)",
                    examples: ["0", "50", "100"]
                })),
                cursor: t.Optional(t.String({
                    format: "uuid",
                    description: "Cursor for pagination (ID of last group from previous page, only for cursor-based pagination)",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                parent_id: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter nomenclature groups by parent ID",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                pagination_type: t.Optional(
                    t.Union([t.Literal("offset"), t.Literal("cursor")], {
                        default: "offset",
                        description: "Type of pagination to use"
                    })
                ),
            }),
            response: {
                200: t.Object({
                    data: t.Array(
                        t.Object({
                            id: t.String({
                                format: "uuid",
                                description: "Nomenclature group unique identifier"
                            }),
                            deleted: t.Boolean({
                                description: "Whether the group is deleted"
                            }),
                            name: t.String({
                                description: "Nomenclature group name"
                            }),
                            tax_category_id: t.Nullable(t.String({
                                format: "uuid",
                                description: "Tax category ID"
                            })),
                            category_id: t.Nullable(t.String({
                                format: "uuid",
                                description: "Category ID"
                            })),
                            accounting_category_id: t.Nullable(t.String({
                                format: "uuid",
                                description: "Accounting category ID"
                            })),
                            parent_id: t.Nullable(t.String({
                                format: "uuid",
                                description: "Parent group ID"
                            })),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of nomenclature groups (only for offset pagination)"
                    })),
                    next_cursor: t.Optional(t.Nullable(t.String({
                        format: "uuid",
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    has_more: t.Optional(t.Boolean({
                        description: "Whether there are more groups to fetch (only for cursor pagination)"
                    })),
                }),
            },
            detail: {
                summary: "Get Nomenclature Groups List",
                description: `Retrieve a paginated list of nomenclature groups. Supports two pagination strategies:

**Offset Pagination** (default):
- Use \`limit\` and \`offset\` parameters
- Returns \`total\` count in response
- Best for: Fixed page numbers, showing total count
- Example: \`?limit=20&offset=40\` (page 3 of 20 items per page)

**Cursor Pagination**:
- Use \`limit\` and \`cursor\` parameters with \`pagination_type=cursor\`
- Returns \`next_cursor\` and \`has_more\` in response
- Best for: Infinite scroll, real-time data, large datasets
- Example: \`?limit=20&cursor=<id>&pagination_type=cursor\`

**Filtering**:
- Filter by parent group using \`parent_id\` parameter
- Works with both pagination types

All endpoints require partner authentication via Bearer token.`,
                tags: ["Partners Nomenclature Group"],
            },
        }
    );
