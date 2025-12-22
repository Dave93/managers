import Elysia, { t } from "elysia";
import { suppliers } from "backend/drizzle/schema";
import { and, eq, gt, sql, SQLWrapper } from "drizzle-orm";
import { ctx } from "@backend/context";

export const partnersSuppliersController = new Elysia({
    name: "@api/partners/v1/suppliers",
    tags: ["Partners Suppliers"],
})
    .use(ctx)
    .get(
        "/suppliers",
        async ({ query, drizzle }) => {
            const {
                limit = "50",
                offset,
                cursor,
                pagination_type = "offset",
                is_supplier,
                is_deleted,
            } = query;

            const whereConditions: SQLWrapper[] = [];

            // Filter by supplier flag
            if (is_supplier !== undefined) {
                whereConditions.push(eq(suppliers.supplier, is_supplier === "true"));
            }

            // Filter by deleted flag
            if (is_deleted !== undefined) {
                whereConditions.push(eq(suppliers.deleted, is_deleted === "true"));
            }

            // Cursor-based pagination
            if (pagination_type === "cursor" && cursor) {
                whereConditions.push(gt(suppliers.id, cursor));
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination
            let total: number | undefined;
            if (pagination_type === "offset" || !cursor) {
                const countResult = await drizzle
                    .select({ count: sql<number>`count(*)` })
                    .from(suppliers)
                    .where(whereClause)
                    .execute();
                total = countResult[0].count;
            }

            // Build query
            let query_builder = drizzle
                .select({
                    id: suppliers.id,
                    code: suppliers.code,
                    name: suppliers.name,
                    cardNumber: suppliers.cardNumber,
                    taxpayerIdNumber: suppliers.taxpayerIdNumber,
                    snils: suppliers.snils,
                    departmentCodes: suppliers.departmentCodes,
                    responsibilityDepartmentCodes: suppliers.responsibilityDepartmentCodes,
                    deleted: suppliers.deleted,
                    supplier: suppliers.supplier,
                    employee: suppliers.employee,
                    client: suppliers.client,
                    representsStore: suppliers.representsStore,
                    representedStoreId: suppliers.representedStoreId,
                })
                .from(suppliers)
                .where(whereClause)
                .orderBy(suppliers.id)
                .limit(Number(limit));

            // Add offset for offset-based pagination
            if (pagination_type === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const suppliersList = await query_builder.execute();

            // Prepare response
            const response: {
                data: typeof suppliersList;
                total?: number;
                next_cursor?: string | null;
                has_more?: boolean;
            } = {
                data: suppliersList,
            };

            // Add pagination metadata based on type
            if (pagination_type === "cursor") {
                response.next_cursor =
                    suppliersList.length === Number(limit)
                        ? suppliersList[suppliersList.length - 1].id
                        : null;
                response.has_more = suppliersList.length === Number(limit);
            } else {
                response.total = parseInt(total?.toString() || "0");
            }

            return response;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String({
                    default: "50",
                    description: "Number of suppliers to return per page (1-100)",
                    examples: ["10", "25", "50"]
                })),
                offset: t.Optional(t.String({
                    description: "Offset for pagination (only for offset-based pagination)",
                    examples: ["0", "50", "100"]
                })),
                cursor: t.Optional(t.String({
                    format: "uuid",
                    description: "Cursor for pagination (ID of last element from previous page)",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                pagination_type: t.Optional(
                    t.Union([t.Literal("offset"), t.Literal("cursor")], {
                        default: "offset",
                        description: "Type of pagination to use"
                    })
                ),
                is_supplier: t.Optional(t.String({
                    description: "Filter by supplier flag (true/false)",
                    examples: ["true", "false"]
                })),
                is_deleted: t.Optional(t.String({
                    description: "Filter by deleted flag (true/false)",
                    examples: ["true", "false"]
                })),
            }),
            response: {
                200: t.Object({
                    data: t.Array(
                        t.Object({
                            id: t.String({
                                format: "uuid",
                                description: "Supplier unique identifier"
                            }),
                            code: t.Nullable(t.String({
                                description: "Supplier code"
                            })),
                            name: t.Nullable(t.String({
                                description: "Supplier name"
                            })),
                            cardNumber: t.Nullable(t.String({
                                description: "Card number"
                            })),
                            taxpayerIdNumber: t.Nullable(t.String({
                                description: "Taxpayer identification number (INN)"
                            })),
                            snils: t.Nullable(t.String({
                                description: "SNILS number"
                            })),
                            departmentCodes: t.Nullable(t.String({
                                description: "Department codes (comma-separated)"
                            })),
                            responsibilityDepartmentCodes: t.Nullable(t.String({
                                description: "Responsibility department codes (comma-separated)"
                            })),
                            deleted: t.Nullable(t.Boolean({
                                description: "Whether the supplier is deleted"
                            })),
                            supplier: t.Nullable(t.Boolean({
                                description: "Whether this is a supplier"
                            })),
                            employee: t.Nullable(t.Boolean({
                                description: "Whether this is an employee"
                            })),
                            client: t.Nullable(t.Boolean({
                                description: "Whether this is a client"
                            })),
                            representsStore: t.Nullable(t.Boolean({
                                description: "Whether this represents a store"
                            })),
                            representedStoreId: t.Nullable(t.String({
                                format: "uuid",
                                description: "ID of represented store"
                            })),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of suppliers (only for offset pagination)"
                    })),
                    next_cursor: t.Optional(t.Nullable(t.String({
                        format: "uuid",
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    has_more: t.Optional(t.Boolean({
                        description: "Whether there are more suppliers to fetch (only for cursor pagination)"
                    })),
                }),
            },
            detail: {
                summary: "Get Suppliers List",
                description: `Retrieve a paginated list of suppliers. Supports two pagination strategies:

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
- Filter by supplier flag using \`is_supplier=true\`
- Filter by deleted status using \`is_deleted=false\`

All endpoints require partner authentication via Bearer token.`,
                tags: ["Partners Suppliers"],
            },
        }
    )
    .get(
        "/suppliers/:id",
        async ({ params, drizzle, status }) => {
            const { id } = params;

            const supplier = await drizzle
                .select()
                .from(suppliers)
                .where(eq(suppliers.id, id))
                .execute();

            if (supplier.length === 0) {
                return status(404, {
                    message: "Supplier not found",
                });
            }

            return {
                data: supplier[0],
            };
        },
        {
            params: t.Object({
                id: t.String({
                    format: "uuid",
                    description: "Supplier unique identifier"
                }),
            }),
            response: {
                200: t.Object({
                    data: t.Object({
                        id: t.String({
                            format: "uuid",
                            description: "Supplier unique identifier"
                        }),
                        code: t.Nullable(t.String({
                            description: "Supplier code"
                        })),
                        name: t.Nullable(t.String({
                            description: "Supplier name"
                        })),
                        cardNumber: t.Nullable(t.String({
                            description: "Card number"
                        })),
                        taxpayerIdNumber: t.Nullable(t.String({
                            description: "Taxpayer identification number (INN)"
                        })),
                        snils: t.Nullable(t.String({
                            description: "SNILS number"
                        })),
                        departmentCodes: t.Nullable(t.String({
                            description: "Department codes (comma-separated)"
                        })),
                        responsibilityDepartmentCodes: t.Nullable(t.String({
                            description: "Responsibility department codes (comma-separated)"
                        })),
                        deleted: t.Nullable(t.Boolean({
                            description: "Whether the supplier is deleted"
                        })),
                        supplier: t.Nullable(t.Boolean({
                            description: "Whether this is a supplier"
                        })),
                        employee: t.Nullable(t.Boolean({
                            description: "Whether this is an employee"
                        })),
                        client: t.Nullable(t.Boolean({
                            description: "Whether this is a client"
                        })),
                        representsStore: t.Nullable(t.Boolean({
                            description: "Whether this represents a store"
                        })),
                        representedStoreId: t.Nullable(t.String({
                            format: "uuid",
                            description: "ID of represented store"
                        })),
                    }),
                }),
                404: t.Object({
                    message: t.String(),
                }),
            },
            detail: {
                summary: "Get Supplier by ID",
                description: "Retrieve a single supplier by its unique identifier. Requires partner authentication via Bearer token.",
                tags: ["Partners Suppliers"],
            },
        }
    );
