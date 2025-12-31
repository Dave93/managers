import Elysia, { t } from "elysia";
import { ctx } from "@backend/context";
import { invoices, invoice_items } from "backend/drizzle/schema";
import { and, eq, gt, gte, lte, sql, SQLWrapper } from "drizzle-orm";

// Store ID filter for incoming invoices
const ALLOWED_STORE_ID = "aafd23ee-e90f-492d-b187-98a80ea1f568";

export const partnersInvoicesController = new Elysia({
    name: "@api/partners/v1/invoices",
    tags: ["Partners Invoices"],
})
    .use(ctx)
    .get(
        "/invoices",
        async ({ query, drizzle }) => {
            const {
                limit = "50",
                offset,
                cursor,
                fromDate,
                toDate,
                paginationType = "offset",
                type = "incoming",
                status,
                supplierId,
                productId,
            } = query;

            // Build where clause
            const whereConditions: SQLWrapper[] = [];

            // Always filter by allowed store
            whereConditions.push(eq(invoices.defaultStore, ALLOWED_STORE_ID));

            // Filter by type (incoming/outgoing)
            if (type) {
                whereConditions.push(eq(invoices.type, type));
            }

            // Filter by status
            if (status) {
                whereConditions.push(eq(invoices.status, status));
            }

            // Filter by supplier
            if (supplierId) {
                whereConditions.push(eq(invoices.supplier, supplierId));
            }

            // Add date range filters
            if (fromDate) {
                whereConditions.push(gte(invoices.incomingDate, fromDate));
            }

            if (toDate) {
                whereConditions.push(lte(invoices.incomingDate, toDate));
            }

            // Cursor-based pagination
            if (paginationType === "cursor" && cursor) {
                const [cursorDate, cursorId] = cursor.split('|');
                whereConditions.push(
                    sql`(${invoices.incomingDate}, ${invoices.id}) > (${cursorDate}, ${cursorId})`
                );
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination
            let total: number | undefined;
            if (paginationType === "offset" || !cursor) {
                const countResult = await drizzle
                    .select({ count: sql<number>`count(*)` })
                    .from(invoices)
                    .where(whereClause)
                    .execute();
                total = countResult[0].count;
            }

            // Build query
            let query_builder = drizzle
                .select({
                    id: invoices.id,
                    incomingDocumentNumber: invoices.incomingDocumentNumber,
                    incomingDate: invoices.incomingDate,
                    useDefaultDocumentTime: invoices.useDefaultDocumentTime,
                    dueDate: invoices.dueDate,
                    supplier: invoices.supplier,
                    defaultStore: invoices.defaultStore,
                    invoice: invoices.invoice,
                    documentNumber: invoices.documentNumber,
                    comment: invoices.comment,
                    status: invoices.status,
                    type: invoices.type,
                    accountToCode: invoices.accountToCode,
                    revenueAccountCode: invoices.revenueAccountCode,
                    defaultStoreCode: invoices.defaultStoreCode,
                    counteragentCode: invoices.counteragentCode,
                    linkedIncomingInvoiceId: invoices.linkedIncomingInvoiceId,
                })
                .from(invoices)
                .where(whereClause)
                .orderBy(invoices.incomingDate, invoices.id)
                .limit(Number(limit));

            // Add offset for offset-based pagination
            if (paginationType === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const invoicesList = await query_builder.execute();

            // Get invoice IDs to fetch items
            const invoiceIds = invoicesList.map(inv => inv.id);
            const invoiceDates = invoicesList.map(inv => inv.incomingDate);

            // Fetch invoice items
            let invoiceItemsList: any[] = [];
            if (invoiceIds.length > 0) {
                const itemsWhereConditions: SQLWrapper[] = [
                    sql`${invoice_items.invoice_id} IN ${sql.raw(`(${invoiceIds.map((id) => `'${id}'`).join(', ')})`)}`,
                    gte(invoice_items.invoiceincomingdate, fromDate),
                    lte(invoice_items.invoiceincomingdate, toDate)
                ];

                // Add productId filter to items
                if (productId) {
                    itemsWhereConditions.push(eq(invoice_items.productId, productId));
                }

                invoiceItemsList = await drizzle
                    .select({
                        id: invoice_items.id,
                        invoice_id: invoice_items.invoice_id,
                        isAdditionalExpense: invoice_items.isAdditionalExpense,
                        actualAmount: invoice_items.actualAmount,
                        // price: invoice_items.price,
                        // sum: invoice_items.sum,
                        // vatPercent: invoice_items.vatPercent,
                        // vatSum: invoice_items.vatSum,
                        // discountSum: invoice_items.discountSum,
                        amountUnit: invoice_items.amountUnit,
                        num: invoice_items.num,
                        productArticle: invoice_items.productArticle,
                        amount: invoice_items.amount,
                        // priceWithoutVat: invoice_items.priceWithoutVat,
                        supplierProduct: invoice_items.supplierProduct,
                        supplierProductArticle: invoice_items.supplierProductArticle,
                        storeId: invoice_items.storeId,
                        storeCode: invoice_items.storeCode,
                        productId: invoice_items.productId,
                        invoiceincomingdate: invoice_items.invoiceincomingdate,
                    })
                    .from(invoice_items)
                    .where(and(...itemsWhereConditions))
                    .execute();
            }

            // Combine invoices with their items
            let invoicesWithItems = invoicesList.map(invoice => ({
                ...invoice,
                items: invoiceItemsList.filter(item =>
                    item.invoice_id === invoice.id &&
                    item.invoiceincomingdate === invoice.incomingDate
                ),
            }));

            // Filter out invoices without items when productId is specified
            if (productId) {
                invoicesWithItems = invoicesWithItems.filter(invoice => invoice.items.length > 0);
            }

            // Prepare response
            const response: {
                data: typeof invoicesWithItems;
                total?: number;
                nextCursor?: string | null;
                hasMore?: boolean;
            } = {
                data: invoicesWithItems,
            };

            // Add pagination metadata based on type
            if (paginationType === "cursor") {
                const lastInvoice = invoicesList[invoicesList.length - 1];
                response.nextCursor =
                    invoicesList.length === Number(limit) && lastInvoice
                        ? `${lastInvoice.incomingDate}|${lastInvoice.id}`
                        : null;
                response.hasMore = invoicesList.length === Number(limit);
            } else {
                response.total = parseInt(total?.toString() || "0");
            }

            return response;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String({
                    default: "50",
                    description: "Number of invoices to return per page (1-100)",
                    examples: ["10", "25", "50"]
                })),
                offset: t.Optional(t.String({
                    description: "Offset for pagination (only for offset-based pagination)",
                    examples: ["0", "50", "100"]
                })),
                cursor: t.Optional(t.String({
                    description: "Cursor for pagination (format: 'date|uuid', only for cursor-based pagination)",
                    examples: ["2024-01-15T10:30:00|550e8400-e29b-41d4-a716-446655440000"]
                })),
                fromDate: t.String({
                    format: "date-time",
                    description: "Filter invoices from this date (ISO 8601 format) - REQUIRED",
                    examples: ["2024-01-01T00:00:00Z", "2024-01-15T10:30:00"]
                }),
                toDate: t.String({
                    format: "date-time",
                    description: "Filter invoices until this date (ISO 8601 format) - REQUIRED",
                    examples: ["2024-12-31T23:59:59Z", "2024-01-31T23:59:59"]
                }),
                paginationType: t.Optional(
                    t.Union([t.Literal("offset"), t.Literal("cursor")], {
                        default: "offset",
                        description: "Type of pagination to use"
                    })
                ),
                type: t.Optional(t.String({
                    description: "Filter by invoice type (incoming/outgoing)",
                    default: "incoming",
                    examples: ["incoming", "outgoing"]
                })),
                status: t.Optional(t.String({
                    description: "Filter by invoice status",
                    examples: ["NEW", "PROCESSED", "DELETED"]
                })),
                supplierId: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter by supplier ID",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                productId: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter invoices by product ID (returns invoices containing this product)",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
            }),
            response: {
                200: t.Object({
                    data: t.Array(
                        t.Object({
                            id: t.String({
                                format: "uuid",
                                description: "Invoice unique identifier"
                            }),
                            incomingDocumentNumber: t.Nullable(t.String({
                                description: "Incoming document number"
                            })),
                            incomingDate: t.String({
                                format: "date-time",
                                description: "Invoice incoming date"
                            }),
                            useDefaultDocumentTime: t.Nullable(t.Boolean({
                                description: "Use default document time flag"
                            })),
                            dueDate: t.Nullable(t.String({
                                format: "date-time",
                                description: "Due date"
                            })),
                            supplier: t.Nullable(t.String({
                                format: "uuid",
                                description: "Supplier ID"
                            })),
                            defaultStore: t.Nullable(t.String({
                                format: "uuid",
                                description: "Default store ID"
                            })),
                            invoice: t.Nullable(t.String({
                                description: "Invoice reference"
                            })),
                            documentNumber: t.Nullable(t.String({
                                description: "Document number"
                            })),
                            comment: t.Nullable(t.String({
                                description: "Comment"
                            })),
                            status: t.Nullable(t.String({
                                description: "Invoice status"
                            })),
                            type: t.Nullable(t.String({
                                description: "Invoice type (incoming/outgoing)"
                            })),
                            accountToCode: t.Nullable(t.String({
                                description: "Account to code"
                            })),
                            revenueAccountCode: t.Nullable(t.String({
                                description: "Revenue account code"
                            })),
                            defaultStoreCode: t.Nullable(t.String({
                                description: "Default store code"
                            })),
                            counteragentCode: t.Nullable(t.String({
                                description: "Counteragent code"
                            })),
                            linkedIncomingInvoiceId: t.Nullable(t.String({
                                description: "Linked incoming invoice ID"
                            })),
                            items: t.Array(
                                t.Object({
                                    id: t.String({
                                        format: "uuid",
                                        description: "Invoice item unique identifier"
                                    }),
                                    invoice_id: t.Nullable(t.String({
                                        format: "uuid",
                                        description: "Reference to invoice ID"
                                    })),
                                    isAdditionalExpense: t.Nullable(t.Boolean({
                                        description: "Is additional expense flag"
                                    })),
                                    actualAmount: t.Nullable(t.String({
                                        description: "Actual amount"
                                    })),
                                    // price: t.Nullable(t.Number({
                                    //     description: "Price"
                                    // })),
                                    // sum: t.Nullable(t.Number({
                                    //     description: "Sum"
                                    // })),
                                    // vatPercent: t.Nullable(t.Number({
                                    //     description: "VAT percent"
                                    // })),
                                    // vatSum: t.Nullable(t.Number({
                                    //     description: "VAT sum"
                                    // })),
                                    // discountSum: t.Nullable(t.Number({
                                    //     description: "Discount sum"
                                    // })),
                                    amountUnit: t.Nullable(t.String({
                                        format: "uuid",
                                        description: "Amount unit ID"
                                    })),
                                    num: t.Nullable(t.String({
                                        description: "Item number"
                                    })),
                                    productArticle: t.Nullable(t.String({
                                        description: "Product article"
                                    })),
                                    amount: t.Nullable(t.String({
                                        description: "Amount"
                                    })),
                                    // priceWithoutVat: t.Nullable(t.Number({
                                    //     description: "Price without VAT"
                                    // })),
                                    supplierProduct: t.Nullable(t.String({
                                        description: "Supplier product"
                                    })),
                                    supplierProductArticle: t.Nullable(t.String({
                                        description: "Supplier product article"
                                    })),
                                    storeId: t.Nullable(t.String({
                                        format: "uuid",
                                        description: "Store ID"
                                    })),
                                    storeCode: t.Nullable(t.String({
                                        description: "Store code"
                                    })),
                                    productId: t.Nullable(t.String({
                                        format: "uuid",
                                        description: "Product ID"
                                    })),
                                    invoiceincomingdate: t.String({
                                        format: "date-time",
                                        description: "Invoice incoming date"
                                    }),
                                })
                            ),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of invoices (only for offset pagination)"
                    })),
                    nextCursor: t.Optional(t.Nullable(t.String({
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    hasMore: t.Optional(t.Boolean({
                        description: "Whether there are more invoices to fetch (only for cursor pagination)"
                    })),
                }),
            },
            detail: {
                summary: "Get Invoices with Items",
                description: `Retrieve a paginated list of invoices with their items. Supports two pagination strategies:

**Offset Pagination** (default):
- Use \`limit\` and \`offset\` parameters
- Returns \`total\` count in response
- Best for: Fixed page numbers, showing total count
- Example: \`?limit=20&offset=40\` (page 3 of 20 items per page)

**Cursor Pagination**:
- Use \`limit\` and \`cursor\` parameters with \`paginationType=cursor\`
- Returns \`nextCursor\` and \`hasMore\` in response
- Best for: Infinite scroll, real-time data, large datasets
- Example: \`?limit=20&cursor=2024-01-15T10:30:00|550e8400-e29b-41d4-a716-446655440000&paginationType=cursor\`

**Required Filters**:
- \`fromDate\` and \`toDate\` are **required** to prevent loading all invoices

**Optional Filters**:
- Filter by invoice type using \`type\` parameter (default: incoming)
- Filter by status using \`status\` parameter
- Filter by supplier using \`supplierId\` parameter

**Response**:
Each invoice includes an array of \`items\` containing all invoice items associated with that invoice.

All endpoints require partner authentication via Bearer token.`,
                tags: ["Partners Invoices"],
            },
        }
    )
    .get(
        "/invoices/:id",
        async ({ params, query, drizzle, status }) => {
            const { id } = params;
            const { incomingDate } = query;

            const invoice = await drizzle
                .select()
                .from(invoices)
                .where(and(
                    eq(invoices.id, id),
                    eq(invoices.incomingDate, incomingDate),
                    eq(invoices.defaultStore, ALLOWED_STORE_ID)
                ))
                .execute();

            if (invoice.length === 0) {
                return status(404, {
                    message: "Invoice not found",
                });
            }

            // Fetch invoice items
            const items = await drizzle
                .select()
                .from(invoice_items)
                .where(and(
                    eq(invoice_items.invoice_id, id),
                    eq(invoice_items.invoiceincomingdate, incomingDate)
                ))
                .execute();

            return {
                data: {
                    ...invoice[0],
                    items,
                },
            };
        },
        {
            params: t.Object({
                id: t.String({
                    format: "uuid",
                    description: "Invoice unique identifier"
                }),
            }),
            query: t.Object({
                incomingDate: t.String({
                    format: "date-time",
                    description: "Invoice incoming date (required for composite primary key lookup)",
                    examples: ["2024-01-15T10:30:00Z"]
                }),
            }),
            response: {
                200: t.Object({
                    data: t.Object({
                        id: t.String({
                            format: "uuid",
                            description: "Invoice unique identifier"
                        }),
                        incomingDocumentNumber: t.Nullable(t.String({
                            description: "Incoming document number"
                        })),
                        incomingDate: t.String({
                            format: "date-time",
                            description: "Invoice incoming date"
                        }),
                        useDefaultDocumentTime: t.Nullable(t.Boolean({
                            description: "Use default document time flag"
                        })),
                        dueDate: t.Nullable(t.String({
                            format: "date-time",
                            description: "Due date"
                        })),
                        supplier: t.Nullable(t.String({
                            format: "uuid",
                            description: "Supplier ID"
                        })),
                        defaultStore: t.Nullable(t.String({
                            format: "uuid",
                            description: "Default store ID"
                        })),
                        invoice: t.Nullable(t.String({
                            description: "Invoice reference"
                        })),
                        documentNumber: t.Nullable(t.String({
                            description: "Document number"
                        })),
                        comment: t.Nullable(t.String({
                            description: "Comment"
                        })),
                        status: t.Nullable(t.String({
                            description: "Invoice status"
                        })),
                        type: t.Nullable(t.String({
                            description: "Invoice type"
                        })),
                        accountToCode: t.Nullable(t.String({
                            description: "Account to code"
                        })),
                        revenueAccountCode: t.Nullable(t.String({
                            description: "Revenue account code"
                        })),
                        defaultStoreId: t.Nullable(t.String({
                            description: "Default store ID (varchar)"
                        })),
                        defaultStoreCode: t.Nullable(t.String({
                            description: "Default store code"
                        })),
                        counteragentId: t.Nullable(t.String({
                            description: "Counteragent ID"
                        })),
                        counteragentCode: t.Nullable(t.String({
                            description: "Counteragent code"
                        })),
                        linkedIncomingInvoiceId: t.Nullable(t.String({
                            description: "Linked incoming invoice ID"
                        })),
                        items: t.Array(
                            t.Object({
                                id: t.String({
                                    format: "uuid",
                                    description: "Invoice item unique identifier"
                                }),
                                invoice_id: t.Nullable(t.String({
                                    format: "uuid",
                                    description: "Reference to invoice ID"
                                })),
                                isAdditionalExpense: t.Nullable(t.Boolean({
                                    description: "Is additional expense flag"
                                })),
                                actualAmount: t.Nullable(t.String({
                                    description: "Actual amount"
                                })),
                                price: t.Nullable(t.Number({
                                    description: "Price"
                                })),
                                sum: t.Nullable(t.Number({
                                    description: "Sum"
                                })),
                                vatPercent: t.Nullable(t.Number({
                                    description: "VAT percent"
                                })),
                                vatSum: t.Nullable(t.Number({
                                    description: "VAT sum"
                                })),
                                discountSum: t.Nullable(t.Number({
                                    description: "Discount sum"
                                })),
                                amountUnit: t.Nullable(t.String({
                                    format: "uuid",
                                    description: "Amount unit ID"
                                })),
                                num: t.Nullable(t.String({
                                    description: "Item number"
                                })),
                                productArticle: t.Nullable(t.String({
                                    description: "Product article"
                                })),
                                amount: t.Nullable(t.String({
                                    description: "Amount"
                                })),
                                priceWithoutVat: t.Nullable(t.Number({
                                    description: "Price without VAT"
                                })),
                                priceUnit: t.Nullable(t.String({
                                    description: "Price unit"
                                })),
                                supplierProduct: t.Nullable(t.String({
                                    description: "Supplier product"
                                })),
                                supplierProductArticle: t.Nullable(t.String({
                                    description: "Supplier product article"
                                })),
                                storeId: t.Nullable(t.String({
                                    format: "uuid",
                                    description: "Store ID"
                                })),
                                storeCode: t.Nullable(t.String({
                                    description: "Store code"
                                })),
                                productId: t.Nullable(t.String({
                                    format: "uuid",
                                    description: "Product ID"
                                })),
                                invoiceincomingdate: t.String({
                                    format: "date-time",
                                    description: "Invoice incoming date"
                                }),
                            })
                        ),
                    }),
                }),
                404: t.Object({
                    message: t.String(),
                }),
            },
            detail: {
                summary: "Get Invoice by ID",
                description: "Retrieve a single invoice with its items by ID. Requires both `id` and `incomingDate` due to composite primary key. Requires partner authentication via Bearer token.",
                tags: ["Partners Invoices"],
            },
        }
    );
