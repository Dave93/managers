import Elysia, { t } from "elysia";
import { ctx } from "@backend/context";
import { orders, order_items } from "backend/drizzle/schema";
import { and, eq, gt, gte, lte, sql, SQLWrapper } from "drizzle-orm";

export const partnersOrdersController = new Elysia({
    name: "@api/partners/v1/orders",
    tags: ["Partners Orders"],
})
    .use(ctx)
    .get(
        "/orders",
        async ({ query, drizzle }) => {
            const {
                limit = "50",
                offset,
                cursor,
                organization_id,
                department_id,
                from_date,
                to_date,
                pagination_type = "offset",
            } = query;

            // Build where clause
            const whereConditions: SQLWrapper[] = [];

            // Add organization_id filter if provided
            if (organization_id) {
                whereConditions.push(eq(orders.restaurantGroupId, organization_id));
            }

            // Add department_id (terminal) filter if provided
            if (department_id) {
                whereConditions.push(eq(orders.departmentId, department_id));
            }

            // Add date range filters
            if (from_date) {
                whereConditions.push(gte(orders.openDateTyped, from_date));
            }

            if (to_date) {
                whereConditions.push(lte(orders.openDateTyped, to_date));
            }

            // Cursor-based pagination
            if (pagination_type === "cursor" && cursor) {
                // For cursor pagination, we use openDateTyped + id composite
                const [cursorDate, cursorId] = cursor.split('|');
                whereConditions.push(
                    sql`(${orders.openDateTyped}, ${orders.id}) > (${cursorDate}, ${cursorId})`
                );
            }

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

            // Get total count for offset pagination or when no cursor is provided
            let total: number | undefined;
            if (pagination_type === "offset" || !cursor) {
                const countResult = await drizzle
                    .select({ count: sql<number>`count(*)` })
                    .from(orders)
                    .where(whereClause)
                    .execute();
                total = countResult[0].count;
            }

            // Build query based on pagination type
            let query_builder = drizzle
                .select({
                    id: orders.id,
                    cashRegisterName: orders.cashRegisterName,
                    cashRegisterNumber: orders.cashRegisterNumber,
                    openTime: orders.openTime,
                    closeTime: orders.closeTime,
                    openDateTyped: orders.openDateTyped,
                    deliveryActualTime: orders.deliveryActualTime,
                    deliveryBillTime: orders.deliveryBillTime,
                    deliveryCloseTime: orders.deliveryCloseTime,
                    deliveryCustomerPhone: orders.deliveryCustomerPhone,
                    deliveryEmail: orders.deliveryEmail,
                    deliveryId: orders.deliveryId,
                    isDelivery: orders.isDelivery,
                    deliveryNumber: orders.deliveryNumber,
                    deliveryPhone: orders.deliveryPhone,
                    deliveryServiceType: orders.deliveryServiceType,
                    department: orders.department,
                    departmentId: orders.departmentId,
                    discountPercent: orders.discountPercent,
                    discountSum: orders.discountSum,
                    dishAmountInt: orders.dishAmountInt,
                    dishDiscountSumInt: orders.dishDiscountSumInt,
                    externalNumber: orders.externalNumber,
                    fiscalChequeNumber: orders.fiscalChequeNumber,
                    orderNum: orders.orderNum,
                    orderServiceType: orders.orderServiceType,
                    orderType: orders.orderType,
                    orderTypeId: orders.orderTypeId,
                    payTypesCombo: orders.payTypesCombo,
                    restaurantGroup: orders.restaurantGroup,
                    restaurantGroupId: orders.restaurantGroupId,
                    sessionNum: orders.sessionNum,
                    tableNum: orders.tableNum,
                    uniqOrderIdId: orders.uniqOrderIdId,
                    storned: orders.storned,
                })
                .from(orders)
                .where(whereClause)
                .orderBy(orders.openDateTyped, orders.id)
                .limit(Number(limit));

            // Add offset for offset-based pagination
            if (pagination_type === "offset" && offset) {
                query_builder = query_builder.offset(Number(offset)) as any;
            }

            const ordersList = await query_builder.execute();

            // Get order IDs to fetch items
            const orderIds = ordersList.map(order => order.id);
            const orderDates = ordersList.map(order => order.openDateTyped);

            // Fetch order items for these orders
            let orderItemsList: any[] = [];
            if (orderIds.length > 0) {
                // Build conditions for order items
                const itemsConditions: SQLWrapper[] = [];

                // Match orders by id and openDateTyped pairs
                for (let i = 0; i < orderIds.length; i++) {
                    itemsConditions.push(
                        and(
                            eq(order_items.uniqOrderId, orderIds[i]),
                            eq(order_items.openDateTyped, orderDates[i] as string)
                        )!
                    );
                }

                orderItemsList = await drizzle
                    .select({
                        id: order_items.id,
                        uniqOrderId: order_items.uniqOrderId,
                        dishId: order_items.dishId,
                        dishName: order_items.dishName,
                        dishAmountInt: order_items.dishAmountInt,
                        dishDiscountSumInt: order_items.dishDiscountSumInt,
                        dishType: order_items.dishType,
                        orderType: order_items.orderType,
                        orderTypeId: order_items.orderTypeId,
                        openDateTyped: order_items.openDateTyped,
                        deliveryPhone: order_items.deliveryPhone,
                        restaurantGroup: order_items.restaurantGroup,
                        restaurantGroupId: order_items.restaurantGroupId,
                        department: order_items.department,
                        departmentId: order_items.departmentId,
                    })
                    .from(order_items)
                    .where(sql`(${order_items.uniqOrderId}, ${order_items.openDateTyped}) IN ${sql.raw(`(${orderIds.map((id, idx) => `('${id}', '${orderDates[idx]}')`).join(', ')})`)}`)
                    .execute();
            }

            // Combine orders with their items
            const ordersWithItems = ordersList.map(order => ({
                ...order,
                items: orderItemsList.filter(item =>
                    item.uniqOrderId === order.id &&
                    item.openDateTyped === order.openDateTyped
                ),
            }));

            // Prepare response
            const response: {
                data: typeof ordersWithItems;
                total?: number;
                next_cursor?: string | null;
                has_more?: boolean;
            } = {
                data: ordersWithItems,
            };

            // Add pagination metadata based on type
            if (pagination_type === "cursor") {
                const lastOrder = ordersList[ordersList.length - 1];
                response.next_cursor =
                    ordersList.length === Number(limit) && lastOrder
                        ? `${lastOrder.openDateTyped}|${lastOrder.id}`
                        : null;
                response.has_more = ordersList.length === Number(limit);
            } else {
                response.total = parseInt(total?.toString() || "0");
            }

            return response;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String({
                    default: "50",
                    description: "Number of orders to return per page (1-100)",
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
                organization_id: t.Optional(t.String({
                    format: "uuid",
                    description: "Filter orders by organization ID (restaurant group)",
                    examples: ["550e8400-e29b-41d4-a716-446655440000"]
                })),
                department_id: t.Optional(t.String({
                    description: "Filter orders by department ID (terminal/branch)",
                    examples: ["DEPT001", "TERMINAL123"]
                })),
                from_date: t.String({
                    format: "date-time",
                    description: "Filter orders from this date (ISO 8601 format) - REQUIRED",
                    examples: ["2024-01-01T00:00:00Z", "2024-01-15T10:30:00"]
                }),
                to_date: t.String({
                    format: "date-time",
                    description: "Filter orders until this date (ISO 8601 format) - REQUIRED",
                    examples: ["2024-12-31T23:59:59Z", "2024-01-31T23:59:59"]
                }),
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
                                description: "Order unique identifier"
                            }),
                            cashRegisterName: t.Nullable(t.String({
                                description: "Cash register name"
                            })),
                            cashRegisterNumber: t.Nullable(t.String({
                                description: "Cash register number"
                            })),
                            openTime: t.Nullable(t.String({
                                format: "date",
                                description: "Order open time"
                            })),
                            closeTime: t.Nullable(t.String({
                                format: "date-time",
                                description: "Order close time"
                            })),
                            openDateTyped: t.String({
                                format: "date-time",
                                description: "Order open date (typed)"
                            }),
                            deliveryActualTime: t.Nullable(t.String({
                                format: "date-time",
                                description: "Actual delivery time"
                            })),
                            deliveryBillTime: t.Nullable(t.String({
                                format: "date-time",
                                description: "Delivery bill time"
                            })),
                            deliveryCloseTime: t.Nullable(t.String({
                                format: "date-time",
                                description: "Delivery close time"
                            })),
                            deliveryCustomerPhone: t.Nullable(t.String({
                                description: "Customer phone for delivery"
                            })),
                            deliveryEmail: t.Nullable(t.String({
                                description: "Customer email for delivery"
                            })),
                            deliveryId: t.Nullable(t.String({
                                description: "Delivery ID"
                            })),
                            isDelivery: t.Nullable(t.String({
                                description: "Is delivery order"
                            })),
                            deliveryNumber: t.Nullable(t.String({
                                description: "Delivery number"
                            })),
                            deliveryPhone: t.Nullable(t.String({
                                description: "Delivery phone"
                            })),
                            deliveryServiceType: t.Nullable(t.String({
                                description: "Delivery service type"
                            })),
                            department: t.Nullable(t.String({
                                description: "Department name"
                            })),
                            departmentId: t.Nullable(t.String({
                                description: "Department ID (terminal)"
                            })),
                            discountPercent: t.Nullable(t.String({
                                description: "Discount percentage"
                            })),
                            discountSum: t.Nullable(t.String({
                                description: "Discount sum"
                            })),
                            dishAmountInt: t.Nullable(t.String({
                                description: "Total dish amount"
                            })),
                            dishDiscountSumInt: t.Nullable(t.String({
                                description: "Total dish discount sum"
                            })),
                            externalNumber: t.Nullable(t.String({
                                description: "External order number"
                            })),
                            fiscalChequeNumber: t.Nullable(t.String({
                                description: "Fiscal cheque number"
                            })),
                            orderNum: t.Nullable(t.String({
                                description: "Order number"
                            })),
                            orderServiceType: t.Nullable(t.String({
                                description: "Order service type"
                            })),
                            orderType: t.Nullable(t.String({
                                description: "Order type name"
                            })),
                            orderTypeId: t.Nullable(t.String({
                                description: "Order type ID"
                            })),
                            payTypesCombo: t.Nullable(t.String({
                                description: "Payment types combination"
                            })),
                            restaurantGroup: t.Nullable(t.String({
                                description: "Restaurant group name"
                            })),
                            restaurantGroupId: t.Nullable(t.String({
                                format: "uuid",
                                description: "Restaurant group ID (organization)"
                            })),
                            sessionNum: t.Nullable(t.String({
                                description: "Session number"
                            })),
                            tableNum: t.Nullable(t.String({
                                description: "Table number"
                            })),
                            uniqOrderIdId: t.Nullable(t.String({
                                format: "uuid",
                                description: "Unique order ID"
                            })),
                            storned: t.Nullable(t.String({
                                description: "Is order cancelled/storned"
                            })),
                            items: t.Array(
                                t.Object({
                                    id: t.String({
                                        format: "uuid",
                                        description: "Order item unique identifier"
                                    }),
                                    uniqOrderId: t.String({
                                        format: "uuid",
                                        description: "Reference to order ID"
                                    }),
                                    dishId: t.Nullable(t.String({
                                        format: "uuid",
                                        description: "Dish/product ID"
                                    })),
                                    dishName: t.Nullable(t.String({
                                        description: "Dish/product name"
                                    })),
                                    dishAmountInt: t.Nullable(t.String({
                                        description: "Dish amount"
                                    })),
                                    dishDiscountSumInt: t.Nullable(t.String({
                                        description: "Dish discount sum"
                                    })),
                                    dishType: t.Nullable(t.String({
                                        description: "Dish type"
                                    })),
                                    orderType: t.Nullable(t.String({
                                        description: "Order type"
                                    })),
                                    orderTypeId: t.Nullable(t.String({
                                        description: "Order type ID"
                                    })),
                                    openDateTyped: t.String({
                                        format: "date-time",
                                        description: "Order open date"
                                    }),
                                    deliveryPhone: t.Nullable(t.String({
                                        description: "Delivery phone"
                                    })),
                                    restaurantGroup: t.Nullable(t.String({
                                        description: "Restaurant group name"
                                    })),
                                    restaurantGroupId: t.Nullable(t.String({
                                        format: "uuid",
                                        description: "Restaurant group ID"
                                    })),
                                    department: t.Nullable(t.String({
                                        description: "Department name"
                                    })),
                                    departmentId: t.Nullable(t.String({
                                        description: "Department ID"
                                    })),
                                })
                            ),
                        })
                    ),
                    total: t.Optional(t.Number({
                        description: "Total number of orders (only for offset pagination)"
                    })),
                    next_cursor: t.Optional(t.Nullable(t.String({
                        description: "Cursor for next page (only for cursor pagination)"
                    }))),
                    has_more: t.Optional(t.Boolean({
                        description: "Whether there are more orders to fetch (only for cursor pagination)"
                    })),
                }),
            },
            detail: {
                summary: "Get Orders with Items",
                description: `Retrieve a paginated list of orders with their items. Supports two pagination strategies:

**Offset Pagination** (default):
- Use \`limit\` and \`offset\` parameters
- Returns \`total\` count in response
- Best for: Fixed page numbers, showing total count
- Example: \`?limit=20&offset=40\` (page 3 of 20 items per page)

**Cursor Pagination**:
- Use \`limit\` and \`cursor\` parameters with \`pagination_type=cursor\`
- Returns \`next_cursor\` and \`has_more\` in response
- Best for: Infinite scroll, real-time data, large datasets
- Example: \`?limit=20&cursor=2024-01-15T10:30:00|550e8400-e29b-41d4-a716-446655440000&pagination_type=cursor\`

**Required Filters**:
- \`from_date\` and \`to_date\` are **required** to prevent loading all orders
- Returns 400 error if date range is not provided

**Optional Filters**:
- Filter by organization using \`organization_id\` parameter
- Filter by department/terminal using \`department_id\` parameter
- All filters work with both pagination types

**Response**:
Each order includes an array of \`items\` containing all order items (dishes/products) associated with that order.

All endpoints require partner authentication via Bearer token.`,
                tags: ["Partners Orders"],
            },
        }
    );
