import Elysia, { t } from "elysia";
import { partnersMiddleware } from "../middleware";
import { nomenclature_element, nomenclature_element_organization } from "backend/drizzle/schema";
import { and, eq, gt, sql, SQLWrapper } from "drizzle-orm";
import { ctx } from "@backend/context";

export const partnersNomenclatureElementController = new Elysia({
    name: "@api/partners/v1/nomenclature_element",
    tags: ["Partners Nomenclature Element"],
})
    .use(ctx)
    .get(
        "/nomenclature-elements",
        async ({ query, drizzle }) => {
            const {
                limit = "50",
                offset,
                cursor,
                organization_id,
                pagination_type = "offset",
                id,
            } = query;

            // Build where clause
            const whereConditions: SQLWrapper[] = [];

            // Add id filter if provided
            if (id) {
                whereConditions.push(eq(nomenclature_element.id, id));
            }

            // Add organization_id filter if provided - using JOIN with nomenclature_element_organization
            if (organization_id) {
                whereConditions.push(eq(nomenclature_element_organization.organization_id, organization_id));
            }

            // Cursor-based pagination
            if (pagination_type === "cursor" && cursor) {
                whereConditions.push(gt(nomenclature_element.id, cursor));
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination or when no cursor is provided
            let total: number | undefined;
            if (pagination_type === "offset" || !cursor) {
                const countQuery = drizzle
                    .select({ count: sql<number>`count(*)` })
                    .from(nomenclature_element);

                if (organization_id) {
                    countQuery
                        .leftJoin(
                            nomenclature_element_organization,
                            eq(nomenclature_element.id, nomenclature_element_organization.nomenclature_element_id)
                        )
                        .where(whereClause);
                } else {
                    countQuery.where(whereClause);
                }

                const countResult = await countQuery.execute();
                total = countResult[0].count;
            }

            // Build query based on pagination type
            let query_builder = drizzle
                .select({
                    id: nomenclature_element.id,
                    deleted: nomenclature_element.deleted,
                    name: nomenclature_element.name,
                    code: nomenclature_element.code,
                    num: nomenclature_element.num,
                    tax_category_id: nomenclature_element.tax_category_id,
                    category_id: nomenclature_element.category_id,
                    accounting_category_id: nomenclature_element.accounting_category_id,
                    mainUnit: nomenclature_element.mainUnit,
                    type: nomenclature_element.type,
                    unitWeight: nomenclature_element.unitWeight,
                    unitCapacity: nomenclature_element.unitCapacity,
                    parent_id: nomenclature_element.parent_id,
                })
                .from(nomenclature_element)
                .orderBy(nomenclature_element.id)
                .limit(Number(limit));

            // Add organization join if filter is provided
            if (organization_id) {
                query_builder = query_builder
                    .leftJoin(
                        nomenclature_element_organization,
                        eq(nomenclature_element.id, nomenclature_element_organization.nomenclature_element_id)
                    )
                    .where(whereClause) as any;
            } else {
                query_builder = query_builder.where(whereClause) as any;
            }

            // Add offset for offset-based pagination
            if (pagination_type === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const nomenclatureList = await query_builder.execute();

            // Prepare response
            const response: {
                data: typeof nomenclatureList;
                total?: number;
                next_cursor?: string | null;
                has_more?: boolean;
            } = {
                data: nomenclatureList,
            };

            // Add pagination metadata based on type
            if (pagination_type === "cursor") {
                response.next_cursor =
                    nomenclatureList.length === Number(limit)
                        ? nomenclatureList[nomenclatureList.length - 1].id
                        : null;
                response.has_more = nomenclatureList.length === Number(limit);
            } else {
                response.total = parseInt(total?.toString() || "0");
            }
            return response;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String({
                    default: "50",
                    description: "Number of nomenclature elements to return per page (1-100)",
                    examples: ["10", "25", "50"]
                })),
                offset: t.Optional(t.String({
                    description: "Offset for pagination (only for offset-based pagination)",
                    examples: ["0", "50", "100"]
                })),
                cursor: t.Optional(t.String({
                    format: "uuid",
                    description: "Cursor for pagination (ID of last element from previous page, only for cursor-based pagination)",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                organization_id: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter nomenclature elements by organization ID",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                id: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter by nomenclature element ID",
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
                                description: "Nomenclature element unique identifier"
                            }),
                            deleted: t.Nullable(t.Boolean({
                                description: "Whether the element is deleted"
                            })),
                            name: t.Nullable(t.String({
                                description: "Nomenclature element name"
                            })),
                            code: t.Nullable(t.String({
                                description: "Nomenclature element code"
                            })),
                            num: t.Nullable(t.String({
                                description: "Nomenclature element number"
                            })),
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
                            mainUnit: t.Nullable(t.String({
                                format: "uuid",
                                description: "Main unit ID"
                            })),
                            type: t.Nullable(t.String({
                                description: "Nomenclature element type"
                            })),
                            unitWeight: t.Nullable(t.String({
                                description: "Unit weight"
                            })),
                            unitCapacity: t.Nullable(t.String({
                                description: "Unit capacity"
                            })),
                            parent_id: t.Nullable(t.String({
                                format: "uuid",
                                description: "Parent element ID"
                            })),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of nomenclature elements (only for offset pagination)"
                    })),
                    next_cursor: t.Optional(t.Nullable(t.String({
                        format: "uuid",
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    has_more: t.Optional(t.Boolean({
                        description: "Whether there are more elements to fetch (only for cursor pagination)"
                    })),
                }),
            },
            detail: {
                summary: "Get Nomenclature Elements List",
                description: `Retrieve a paginated list of nomenclature elements. Supports two pagination strategies:

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
                tags: ["Partners Nomenclature Element"],
            },
        }
    );
