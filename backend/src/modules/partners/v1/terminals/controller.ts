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
                organizationId,
                paginationType = "offset",
            } = query;

            // Build where clause
            const whereConditions: SQLWrapper[] = [];

            // Add organization_id filter if provided
            if (organizationId) {
                whereConditions.push(eq(terminals.organization_id, organizationId));
            }

            // Cursor-based pagination
            if (paginationType === "cursor" && cursor) {
                whereConditions.push(gt(terminals.id, cursor));
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination or when no cursor is provided
            let total: number | undefined;
            if (paginationType === "offset" || !cursor) {
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
            if (paginationType === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const terminalList = await query_builder.execute();

            // Prepare response
            const response: {
                data: {
                    id: string;
                    name: string;
                    active: boolean;
                    phone: string | null;
                    address: string | null;
                    latitude: number;
                    longitude: number;
                    organizationId: string;
                    managerName: string | null;
                    createdAt: string;
                    updatedAt: string;
                }[];
                total?: number;
                nextCursor?: string | null;
                hasMore?: boolean;
            } = {
                data: terminalList.map(terminal => ({
                    id: terminal.id,
                    name: terminal.name,
                    active: terminal.active,
                    phone: terminal.phone,
                    address: terminal.address,
                    latitude: terminal.latitude,
                    longitude: terminal.longitude,
                    organizationId: terminal.organization_id,
                    managerName: terminal.manager_name,
                    createdAt: terminal.created_at,
                    updatedAt: terminal.updated_at,
                })),
            };

            // Add pagination metadata based on type
            if (paginationType === "cursor") {
                response.nextCursor =
                    terminalList.length === Number(limit)
                        ? terminalList[terminalList.length - 1].id
                        : null;
                response.hasMore = terminalList.length === Number(limit);
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
                organizationId: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter terminals by organization ID",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                paginationType: t.Optional(
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
                            organizationId: t.String({
                                format: "uuid",
                                description: "ID of organization this terminal belongs to"
                            }),
                            managerName: t.Nullable(t.String({
                                description: "Name of terminal manager"
                            })),
                            createdAt: t.String({
                                format: "date-time",
                                description: "Terminal creation timestamp"
                            }),
                            updatedAt: t.String({
                                format: "date-time",
                                description: "Terminal last update timestamp"
                            }),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of terminals (only for offset pagination)"
                    })),
                    nextCursor: t.Optional(t.Nullable(t.String({
                        format: "uuid",
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    hasMore: t.Optional(t.Boolean({
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
- Use \`limit\` and \`cursor\` parameters with \`paginationType=cursor\`
- Returns \`nextCursor\` and \`hasMore\` in response
- Best for: Infinite scroll, real-time data, large datasets
- Example: \`?limit=20&cursor=<id>&paginationType=cursor\`

**Filtering**:
- Filter by organization using \`organizationId\` parameter
- Works with both pagination types

All endpoints require partner authentication via Bearer token.`,
                tags: ["Partners Terminals"],
            },
        }
    );