import Elysia, { t } from "elysia";
import { partnersMiddleware } from "../middleware";
import { terminals } from "backend/drizzle/schema";
import { and, eq, gt, sql, SQLWrapper } from "drizzle-orm";
import { ctx } from "@backend/context";

export const partnersTerminalsController = new Elysia({
    name: "@api/partners/v1/terminals",
    tags: ["Partners Terminals"],
})
    .use(ctx)
    .get(
        "/terminals",
        async ({ query, drizzle }) => {
            const {
                limit = "50",
                offset,
                cursor,
                organization_id,
                pagination_type = "offset",
            } = query;

            // Build where clause
            const whereConditions: SQLWrapper[] = [];

            // Add organization_id filter if provided
            if (organization_id) {
                whereConditions.push(eq(terminals.organization_id, organization_id));
            }

            // Cursor-based pagination
            if (pagination_type === "cursor" && cursor) {
                whereConditions.push(gt(terminals.id, cursor));
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination or when no cursor is provided
            let total: number | undefined;
            if (pagination_type === "offset" || !cursor) {
                const countResult = await drizzle
                    .select({ count: sql<number>`count(*)` })
                    .from(terminals)
                    .where(whereClause)
                    .execute();
                total = countResult[0].count;
            }

            // Build query based on pagination type
            let query_builder = drizzle
                .select()
                .from(terminals)
                .where(whereClause)
                .orderBy(terminals.id)
                .limit(Number(limit));

            // Add offset for offset-based pagination
            if (pagination_type === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const terminalList = await query_builder.execute();

            // Prepare response
            const response: {
                data: typeof terminalList;
                total?: number;
                next_cursor?: string | null;
                has_more?: boolean;
            } = {
                data: terminalList,
            };

            // Add pagination metadata based on type
            if (pagination_type === "cursor") {
                response.next_cursor =
                    terminalList.length === Number(limit)
                        ? terminalList[terminalList.length - 1].id
                        : null;
                response.has_more = terminalList.length === Number(limit);
            } else {
                response.total = parseInt(total?.toString() || "0");
            }
            return response;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String({
                    default: "50",
                    description: "Number of terminals to return per page (1-100)",
                    examples: ["10", "25", "50"]
                })),
                offset: t.Optional(t.String({
                    description: "Offset for pagination (only for offset-based pagination)",
                    examples: ["0", "50", "100"]
                })),
                cursor: t.Optional(t.String({
                    format: "uuid",
                    description: "Cursor for pagination (ID of last terminal from previous page, only for cursor-based pagination)",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                organization_id: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter terminals by organization ID",
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
                                description: "Terminal unique identifier"
                            }),
                            name: t.String({
                                description: "Terminal name"
                            }),
                            active: t.Boolean({
                                description: "Whether the terminal is active"
                            }),
                            phone: t.Nullable(t.String({
                                description: "Terminal phone number"
                            })),
                            address: t.Nullable(t.String({
                                description: "Terminal physical address"
                            })),
                            latitude: t.Number({
                                description: "Terminal latitude coordinate"
                            }),
                            longitude: t.Number({
                                description: "Terminal longitude coordinate"
                            }),
                            organization_id: t.String({
                                format: "uuid",
                                description: "ID of organization this terminal belongs to"
                            }),
                            manager_name: t.Nullable(t.String({
                                description: "Name of terminal manager"
                            })),
                            created_at: t.String({
                                format: "date-time",
                                description: "Terminal creation timestamp"
                            }),
                            updated_at: t.String({
                                format: "date-time",
                                description: "Terminal last update timestamp"
                            }),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of terminals (only for offset pagination)"
                    })),
                    next_cursor: t.Optional(t.Nullable(t.String({
                        format: "uuid",
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    has_more: t.Optional(t.Boolean({
                        description: "Whether there are more terminals to fetch (only for cursor pagination)"
                    })),
                }),
            },
            detail: {
                summary: "Get Terminals List",
                description: `Retrieve a paginated list of terminals. Supports two pagination strategies:

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
- Filter by organization using \`organization_id\` parameter
- Works with both pagination types

All endpoints require partner authentication via Bearer token.`,
                tags: ["Partners Terminals"],
            },
        }
    );