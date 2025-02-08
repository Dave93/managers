import { ctx } from "@backend/context";
import dayjs from "dayjs";
import { sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import * as XLSX from 'xlsx';

type IntervalType = '1 day' | '1 week' | '1 month';

const getAggregationTable = (interval: string | undefined): string => {
    const tables: Record<IntervalType, string> = {
        '1 day': 'revenue_daily_aggregation',
        '1 week': 'revenue_weekly_aggregation',
        '1 month': 'revenue_monthly_aggregation'
    };
    return tables[interval as IntervalType] || 'revenue_daily_aggregation';
};

const getIntervalForTimeBucket = (interval: string): IntervalType => {
    return (['1 day', '1 week', '1 month'].includes(interval) ? interval : '1 day') as IntervalType;
};

const fetchData = async (drizzle: any, startDate: string, endDate: string, terminals: string | undefined, interval: string) => {
    const terminalList = terminals?.split(',') || null;
    const intervalForTimeBucket = getIntervalForTimeBucket(interval);

    const result = await drizzle.execute(sql`
        CALL get_revenue_and_order_count(
            ${startDate}::timestamp,
            ${endDate}::timestamp,
            ${intervalForTimeBucket}::interval,
            ${terminalList ? sql`ARRAY[${sql.join(terminalList)}]::varchar[]` : sql`NULL`}
        )
    `);

    if (!Array.isArray(result.rows)) {
        throw new Error("Unexpected data format: not an array");
    }

    return result.rows.map((item: { date: any; current_revenue: string; previous_revenue: string | null; current_order_count: string; previous_order_count: string | null; }) => ({
        date: item.date,
        current_revenue: parseFloat(item.current_revenue) || 0,
        previous_revenue: item.previous_revenue !== null ? parseFloat(item.previous_revenue) || 0 : null,
        current_order_count: parseInt(item.current_order_count) || 0,
        previous_order_count: item.previous_order_count !== null ? parseInt(item.previous_order_count) || 0 : null
    }));
};

export const chartsController = new Elysia({
    name: "@api/charts",
})
    .use(ctx)
    .get(
        "/charts/revenue/export", async ({
            query: {
                startDate,
                endDate,
                terminals,
                interval,
            },
            user,
            set,
            drizzle,
        }) => {

        try {
            if (!interval) {
                interval = '1 day';
            }
            const data = await fetchData(drizzle, startDate, endDate, terminals, interval);

            // Create a new workbook and add a worksheet
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);

            // Add the worksheet to the workbook
            XLSX.utils.book_append_sheet(wb, ws, "Revenue Data");

            // Generate XLSX file
            const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

            // Set response headers
            set.headers['Content-Disposition'] = `attachment; filename="revenue_data_${startDate}_${endDate}.xlsx"`;
            set.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

            // Return the XLSX file
            return xlsxBuffer;
        } catch (error) {
            console.error("Error exporting data:", error);
            set.status = 500;
            return { message: "Error exporting data" };
        }
    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            terminals: t.Optional(t.String()),
            interval: t.Optional(t.String({ default: "1 day" }))
        }),
    })
    .get(
        "/charts/revenue", async ({
            query: {
                startDate,
                endDate,
                terminals,
                interval,
                organizationId
            },
            user,
            set,
            drizzle,
            cacheController
        }) => {
        const apiStartTime = performance.now()

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);

        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);

        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;
        const aggregationTable = getAggregationTable(interval!);
        const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;

        const previousPeriodOffset = interval === '1 week' ? sql`INTERVAL '52 weeks'` : sql`INTERVAL '1 year'`;

        const sqlQuery = sql`
            WITH current_period AS (
                SELECT
                    bucket as date,
                    SUM(total_revenue) as current_revenue
                FROM ${sql.identifier(aggregationTable)}
                WHERE
                    bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                    ${terminalCondition}
                    ${organizationCondition}
                GROUP BY bucket
            ),
            previous_period AS (
                SELECT
                    (bucket + ${previousPeriodOffset}) as date,
                    SUM(total_revenue) as previous_revenue
                FROM ${sql.identifier(aggregationTable)}
                WHERE
                    bucket BETWEEN (${startDate}::timestamp - ${previousPeriodOffset}) AND (${endDate}::timestamp - ${previousPeriodOffset})
                    ${terminalCondition}
                    ${organizationCondition}
                GROUP BY bucket
            )
            SELECT 
                c.date,
                c.current_revenue,
                p.previous_revenue
            FROM current_period c
            LEFT JOIN previous_period p USING (date)
            ORDER BY c.date
        `;
        try {
            console.time('sqlQuery');
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                date: string;
                current_revenue: string;
                previous_revenue: string | null;
            }>(sqlQuery)).rows;
            console.timeEnd('sqlQuery');
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()
            console.timeEnd('api')
            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }
            return {
                data: result.map(item => ({
                    date: item.date,
                    current_revenue: parseFloat(item.current_revenue) || 0,
                    previous_revenue: item.previous_revenue !== null ? parseFloat(item.previous_revenue) || 0 : null
                })),
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            }
        } catch (error) {
            console.error("Error fetching data:", error);
            set.status = 500;
            return { message: "Error fetching data" };
        }
    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            terminals: t.Optional(t.String()),
            interval: t.Optional(t.String({ default: "1 day" })),
            organizationId: t.Optional(t.String()),
        }),
    })
    .get(
        "/charts/order-count",
        async ({
            query: { startDate, endDate, terminals, interval,
                organizationId },
            user,
            set,
            drizzle,
            cacheController
        }) => {
            const apiStartTime = performance.now();

            const cachedTerminals = await cacheController.getCachedTerminals({});
            let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
            if (user?.terminals && user.terminals.length > 0) {
                currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
            }
            const terminalList = currentTerminals.map(terminal => {
                const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
                return credentials?.key;
            }).filter(id => id !== null);
            const terminalCondition = terminalList.length > 0
                ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
                : sql``;
            const aggregationTable = getAggregationTable(interval);
            const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;
            const previousPeriodOffset = interval === '1 week' ? sql`INTERVAL '52 weeks'` : sql`INTERVAL '1 year'`;

            const sqlQuery = sql`
            WITH current_period AS (
              SELECT
                bucket as date,
                SUM(order_count) as current_order_count
              FROM ${sql.identifier(aggregationTable)}
              WHERE
                bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                ${terminalCondition}
                ${organizationCondition}
              GROUP BY bucket
            ),
            previous_period AS (
              SELECT
                (bucket + ${previousPeriodOffset}) as date,
                SUM(order_count) as previous_order_count
              FROM ${sql.identifier(aggregationTable)}
              WHERE
                bucket BETWEEN (${startDate}::timestamp - ${previousPeriodOffset}) AND (${endDate}::timestamp - ${previousPeriodOffset})
                ${terminalCondition}
                ${organizationCondition}
              GROUP BY bucket
            )
            SELECT 
              c.date,
              c.current_order_count,
              p.previous_order_count
            FROM current_period c
            LEFT JOIN previous_period p USING (date)
            ORDER BY c.date
          `;

            try {
                const sqlStartTime = performance.now()
                const result = (await drizzle.execute<{
                    date: string;
                    current_order_count: string;
                    previous_order_count: string | null;
                }>(sqlQuery)).rows;
                const sqlEndTime = performance.now()

                const apiEndTime = performance.now()
                console.timeEnd('api')

                if (!Array.isArray(result)) {
                    throw new Error("Unexpected data format: not an array");
                }

                return {
                    data: result.map(item => ({
                        date: item.date,
                        current_order_count: parseInt(item.current_order_count) || 0,
                        previous_order_count: item.previous_order_count !== null ? parseInt(item.previous_order_count) || 0 : null
                    })),
                    debug: {
                        sqlQueryTime: sqlEndTime - sqlStartTime,
                        apiTime: apiEndTime - apiStartTime
                    }
                }
            } catch (error) {
                console.error("Error fetching order count data:", error);
                set.status = 500;
                return { message: "Error fetching order count data" };
            }
        },
        {
            permission: "charts.list",
            query: t.Object({
                startDate: t.String(),
                endDate: t.String(),
                terminals: t.Optional(t.String()),
                interval: t.Optional(t.String({ default: "1 day" })),
                organizationId: t.Optional(t.String()),
            }),
        }
    )
    .get(
        "/charts/average-check",
        async ({
            query: { startDate, endDate, terminals, interval, organizationId },
            user,
            set,
            drizzle,
            cacheController
        }) => {
            const apiStartTime = performance.now();


            const aggregationTable = getAggregationTable(interval);

            const cachedTerminals = await cacheController.getCachedTerminals({});

            let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
            if (user?.terminals && user.terminals.length > 0) {
                currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
            }

            const terminalList = currentTerminals.map(terminal => {
                const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
                return credentials?.key;
            }).filter(id => id !== null);

            const terminalCondition = terminalList.length > 0
                ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
                : sql``;
            const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;

            const previousPeriodOffset = interval === '1 week' ? sql`INTERVAL '52 weeks'` : sql`INTERVAL '1 year'`;

            const sqlQuery = sql`
            WITH current_period AS (
              SELECT
                bucket as date,
                SUM(total_revenue) / NULLIF(SUM(order_count), 0) as current_avg_check
              FROM ${sql.identifier(aggregationTable)}
              WHERE
                bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                ${terminalCondition}
                ${organizationCondition}
              GROUP BY bucket
            ),
            previous_period AS (
              SELECT
                (bucket + ${previousPeriodOffset}) as date,
                SUM(total_revenue) / NULLIF(SUM(order_count), 0) as previous_avg_check
              FROM ${sql.identifier(aggregationTable)}
              WHERE
                bucket BETWEEN (${startDate}::timestamp - ${previousPeriodOffset}) AND (${endDate}::timestamp - ${previousPeriodOffset})
                ${terminalCondition}
                ${organizationCondition}
              GROUP BY bucket
            )
            SELECT 
              c.date,
              c.current_avg_check,
              p.previous_avg_check
            FROM current_period c
            LEFT JOIN previous_period p USING (date)
            ORDER BY c.date
          `;

            try {
                const sqlStartTime = performance.now()
                const result = (await drizzle.execute<{
                    date: string;
                    current_avg_check: string;
                    previous_avg_check: string | null;
                }>(sqlQuery)).rows;
                const sqlEndTime = performance.now()

                const apiEndTime = performance.now()
                console.timeEnd('api')

                if (!Array.isArray(result)) {
                    throw new Error("Unexpected data format: not an array");
                }

                return {
                    data: result.map(item => ({
                        date: item.date,
                        current_avg_check: parseFloat(item.current_avg_check) || 0,
                        previous_avg_check: item.previous_avg_check !== null ? parseFloat(item.previous_avg_check) || 0 : null
                    })),
                    debug: {
                        sqlQueryTime: sqlEndTime - sqlStartTime,
                        apiTime: apiEndTime - apiStartTime
                    }
                }
            } catch (error) {
                console.error("Error fetching average check data:", error);
                set.status = 500;
                return { message: "Error fetching average check data" };
            }
        },
        {
            permission: "charts.list",
            query: t.Object({
                startDate: t.String(),
                endDate: t.String(),
                terminals: t.Optional(t.String()),
                interval: t.Optional(t.String({ default: "1 day" })),
                organizationId: t.Optional(t.String()),
            }),
        }
    )
    .get(
        "/charts/order-distribution", async ({
            query: {
                startDate,
                endDate,
                terminals,
                organizationId
            },
            user,
            set,
            drizzle,
            cacheController
        }) => {
        const apiStartTime = performance.now();

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);

        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;

        const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;

        const sqlQuery = sql`
            WITH current_period AS (
                SELECT
                    order_type,
                    order_service_type,
                    COUNT(*) AS value,
                    'current' as period
                FROM orders 
                WHERE
                    open_date_typed BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                    ${terminalCondition}
                    ${organizationCondition}
                GROUP BY order_type, order_service_type
            ),
            previous_period AS (
                SELECT
                    order_type,
                    order_service_type,
                    COUNT(*) AS value,
                    'previous' as period
                FROM orders 
                WHERE
                    open_date_typed BETWEEN (${startDate}::timestamp - INTERVAL '1 year') AND (${endDate}::timestamp - INTERVAL '1 year')
                    ${terminalCondition}
                    ${organizationCondition}
                GROUP BY order_type, order_service_type
            ),
            combined_data AS (
                SELECT * FROM current_period
                UNION ALL
                SELECT * FROM previous_period
            )
            SELECT 
                CASE
                    WHEN order_service_type = 'COMMON' THEN 'Offline'
                    WHEN order_service_type = 'DELIVERY_BY_COURIER' THEN 'Online'
                    WHEN order_service_type = 'DELIVERY_PICKUP' THEN 'Online'
                    ELSE order_service_type
                END AS name,
                SUM(value) as value,
                period
            FROM combined_data
            GROUP BY 
                CASE
                    WHEN order_service_type = 'COMMON' THEN 'Offline'
                    WHEN order_service_type = 'DELIVERY_BY_COURIER' THEN 'Online' 
                    WHEN order_service_type = 'DELIVERY_PICKUP' THEN 'Online'
                    ELSE order_service_type
                END,
                period
            ORDER BY period DESC, value DESC
        `;

        try {
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                name: string;
                value: string;
                period: 'current' | 'previous';
            }>(sqlQuery)).rows;
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()
            console.timeEnd('api')

            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }

            // Разделяем данные на текущий и предыдущий периоды
            const currentPeriodData = result
                .filter(row => row.period === 'current')
                .map(item => ({
                    name: item.name,
                    value: parseInt(item.value, 10)
                }));

            const previousPeriodData = result
                .filter(row => row.period === 'previous')
                .map(item => ({
                    name: item.name,
                    value: parseInt(item.value, 10)
                }));

            return {
                data: {
                    current: currentPeriodData,
                    previous: previousPeriodData
                },
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            };
        } catch (error) {
            console.error("Error fetching order distribution data:", error);
            set.status = 500;
            return { message: "Error fetching order distribution data", error: String(error) };
        }
    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            terminals: t.Optional(t.String()),
            organizationId: t.Optional(t.String()),
        }),
    })
    .get('/charts/hourly-heatmap', async ({
        query: {
            startDate,
            endDate,
            terminals,
            organizationId
        },
        user,
        set,
        drizzle,
        cacheController
    }) => {
        const apiStartTime = performance.now();

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);

        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;

        const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;

        const sqlQuery = sql`
            WITH hourly_data AS (
                SELECT
                    EXTRACT(DOW FROM bucket) AS day_of_week,
                    EXTRACT(HOUR FROM bucket) AS hour,
                    SUM(order_count) AS total_orders,
                    SUM(total_revenue) AS total_revenue,
                    COUNT(DISTINCT DATE(bucket)) AS day_count
                FROM orders_hourly_aggregation
                WHERE
                    bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                    ${terminalCondition}
                    ${organizationCondition}
                GROUP BY day_of_week, hour
            )
            SELECT
                day_of_week,
                hour,
                ROUND(SUM(total_orders) / NULLIF(SUM(day_count), 0)) AS average_order_count,
                ROUND((SUM(total_revenue) / NULLIF(SUM(day_count), 0))::numeric, 2) AS average_revenue
            FROM hourly_data
            GROUP BY day_of_week, hour
            ORDER BY day_of_week, hour
        `;

        try {
            console.time('sqlQuery')
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                day_of_week: string;
                hour: string;
                average_order_count: string;
                average_revenue: string;
            }>(sqlQuery)).rows;
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()
            console.timeEnd('api')

            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }

            const heatmapData = result.map(row => ({
                dayOfWeek: parseInt(row.day_of_week),
                hour: parseInt(row.hour),
                averageOrderCount: parseFloat(row.average_order_count),
                averageRevenue: parseFloat(row.average_revenue)
            }));

            return {
                data: heatmapData,
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            };
        } catch (error) {
            console.error("Error fetching hourly heatmap data:", error);
            set.status = 500;
            return { message: "Error fetching hourly heatmap data" };
        }

    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            terminals: t.Optional(t.String()),
            organizationId: t.Optional(t.String()),
        }),
    })
    .get('/charts/popular-dishes', async ({
        query: {
            startDate,
            endDate,
            terminals,
            organizationId,
        },
        user,
        set,
        drizzle,
        cacheController
    }) => {
        const apiStartTime = performance.now();

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);

        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;


        const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;
        // console.log('terminalCondition', terminalCondition.toString().toString())
        const sqlQuery = sql`
            SELECT
                dish_id,
                dish_name,
                SUM(total_count) as total_sales
            FROM ${sql.identifier('product_daily_aggregation')}
            WHERE
                bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                ${terminalCondition}
                ${organizationCondition}
            GROUP BY dish_id, dish_name
            ORDER BY total_sales DESC
        `;

        try {
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                dish_id: string;
                dish_name: string;
                total_sales: string;
            }>(sqlQuery)).rows;
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()

            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }

            const popularDishesData = result.map(row => ({
                id: row.dish_id,
                name: row.dish_name,
                value: parseInt(row.total_sales, 10)
            }));

            return {
                data: popularDishesData,
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            };
        } catch (error) {
            console.error("Error fetching popular dishes data:", error);
            set.status = 500;
            return { message: "Error fetching popular dishes data" };
        }
    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            terminals: t.Optional(t.String()),
            interval: t.Optional(t.String({ default: "1 day" })),
            organizationId: t.Optional(t.String()),
        }),
    })
    .get('/charts/popular-dishes-by-price', async ({
        query: {
            startDate,
            endDate,
            terminals,
            organizationId,
        },
        user,
        set,
        drizzle,
        cacheController
    }) => {
        const apiStartTime = performance.now();

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);

        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;


        const organizationCondition = organizationId ? sql`AND department_id = ${organizationId}` : sql``;

        const sqlQuery = sql`
            SELECT
                dish_id,
                dish_name,
                SUM(dish_discount_sum_int) as total_amount
            FROM ${sql.identifier('product_daily_aggregation')}
            WHERE
                bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp
                ${terminalCondition}
                ${organizationCondition}
            GROUP BY dish_id, dish_name
            ORDER BY total_amount DESC
        `;

        try {
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                dish_id: string;
                dish_name: string;
                total_amount: string;
            }>(sqlQuery)).rows;
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()

            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }

            const popularDishesData = result.map(row => ({
                id: row.dish_id,
                name: row.dish_name,
                value: parseInt(row.total_amount, 10)
            }));

            return {
                data: popularDishesData,
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            };
        } catch (error) {
            console.error("Error fetching popular dishes data:", error);
            set.status = 500;
            return { message: "Error fetching popular dishes data" };
        }

    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            terminals: t.Optional(t.String()),
            interval: t.Optional(t.String({ default: "1 hour" })),
            organizationId: t.Optional(t.String()),
        }),
    })
    .get(
        "/charts/revenue-by-branches", async ({
            query: {
                startDate,
                endDate,
                organization,
                terminals
            },
            user,
            set,
            drizzle,
            cacheController
        }) => {
        console.time('api')
        const apiStartTime = performance.now()

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);


        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;

        const sqlQuery = sql`
            WITH current_period AS (
                SELECT 
                    rda.restaurant_group_id, 
                    rda.department_id, 
                    SUM(rda.total_revenue) AS current_revenue, 
                    t.name
                FROM 
                    revenue_daily_aggregation rda
                LEFT JOIN 
                    credentials c 
                    ON c.model = 'terminals' 
                    AND c.type = 'iiko_id' 
                    AND c.key = rda.restaurant_group_id::text
                LEFT JOIN 
                    terminals t 
                    ON c.model_id = t.id::text
                WHERE
                    rda.bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp 
                    AND t.id IS NOT NULL 
                    ${terminalCondition}
                    ${organization ? sql`AND rda.department_id = ${organization}` : sql``}
                GROUP BY 
                    rda.restaurant_group_id, rda.department_id, t.name
            ),
            previous_period AS (
                SELECT 
                    rda.restaurant_group_id, 
                    rda.department_id, 
                    SUM(rda.total_revenue) AS previous_revenue
                FROM 
                    revenue_daily_aggregation rda
                WHERE
                    rda.bucket BETWEEN (${startDate}::timestamp - INTERVAL '1 year') AND (${endDate}::timestamp - INTERVAL '1 year')
                    ${terminalCondition}
                    ${organization ? sql`AND rda.department_id = ${organization}` : sql``}
                GROUP BY 
                    rda.restaurant_group_id, rda.department_id
            )
            SELECT 
                cp.name,
                cp.current_revenue,
                pp.previous_revenue
            FROM current_period cp
            LEFT JOIN previous_period pp 
                ON cp.restaurant_group_id = pp.restaurant_group_id 
                AND cp.department_id = pp.department_id
            ORDER BY cp.current_revenue DESC;
        `;

        try {
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                name: string;
                current_revenue: string;
                previous_revenue: string | null;
            }>(sqlQuery)).rows;
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()
            console.timeEnd('api')
            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }
            return {
                data: result.map(item => ({
                    name: item.name,
                    current_revenue: parseFloat(item.current_revenue) || 0,
                    previous_revenue: item.previous_revenue ? parseFloat(item.previous_revenue) : null
                })),
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            }
        } catch (error) {
            console.error("Error fetching data:", error);
            set.status = 500;
            return { message: "Error fetching data" };
        }
    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            organization: t.Optional(t.String()),
            terminals: t.Optional(t.String()),
        }),
    })
    .get(
        "/charts/order-count-by-branches", async ({
            query: {
                startDate,
                endDate,
                organization,
                terminals
            },
            user,
            set,
            drizzle,
            cacheController
        }) => {
        console.time('api')
        const apiStartTime = performance.now()

        const cachedTerminals = await cacheController.getCachedTerminals({});

        let currentTerminals = cachedTerminals.filter(terminal => terminals ? terminals.includes(terminal.id) : true);
        if (user?.terminals && user.terminals.length > 0) {
            currentTerminals = currentTerminals.filter(terminal => user.terminals.includes(terminal.id));
        }

        const terminalList = currentTerminals.map(terminal => {
            const credentials = terminal.credentials.find(cred => cred.type === 'iiko_id');
            return credentials?.key;
        }).filter(id => id !== null);

        const terminalCondition = terminalList.length > 0
            ? sql`AND restaurant_group_id IN (${sql.raw(terminalList.map(id => `'${id}'`).join(','))})`
            : sql``;

        const sqlQuery = sql`
            WITH current_period AS (
                SELECT 
                    rda.restaurant_group_id, 
                    rda.department_id, 
                    SUM(rda.order_count) AS current_order_count, 
                    t.name
                FROM 
                    revenue_daily_aggregation rda
                LEFT JOIN 
                    credentials c 
                    ON c.model = 'terminals' 
                    AND c.type = 'iiko_id' 
                    AND c.key = rda.restaurant_group_id::text
                LEFT JOIN 
                    terminals t 
                    ON c.model_id = t.id::text
                WHERE
                    rda.bucket BETWEEN ${startDate}::timestamp AND ${endDate}::timestamp 
                    AND t.id IS NOT NULL 
                    ${terminalCondition}
                    ${organization ? sql`AND rda.department_id = ${organization}` : sql``}
                GROUP BY 
                    rda.restaurant_group_id, rda.department_id, t.name
            ),
            previous_period AS (
                SELECT 
                    rda.restaurant_group_id, 
                    rda.department_id, 
                    SUM(rda.order_count) AS previous_order_count
                FROM 
                    revenue_daily_aggregation rda
                WHERE
                    rda.bucket BETWEEN (${startDate}::timestamp - INTERVAL '1 year') AND (${endDate}::timestamp - INTERVAL '1 year')
                    ${terminalCondition}
                    ${organization ? sql`AND rda.department_id = ${organization}` : sql``}
                GROUP BY 
                    rda.restaurant_group_id, rda.department_id
            )
            SELECT 
                cp.name,
                cp.current_order_count,
                pp.previous_order_count
            FROM current_period cp
            LEFT JOIN previous_period pp 
                ON cp.restaurant_group_id = pp.restaurant_group_id 
                AND cp.department_id = pp.department_id
            ORDER BY cp.current_order_count DESC;
        `;

        try {
            const sqlStartTime = performance.now()
            const result = (await drizzle.execute<{
                name: string;
                current_order_count: string;
                previous_order_count: string | null;
            }>(sqlQuery)).rows;
            const sqlEndTime = performance.now()

            const apiEndTime = performance.now()
            console.timeEnd('api')
            if (!Array.isArray(result)) {
                throw new Error("Unexpected data format: not an array");
            }
            return {
                data: result.map(item => ({
                    name: item.name,
                    current_order_count: parseInt(item.current_order_count) || 0,
                    previous_order_count: item.previous_order_count ? parseInt(item.previous_order_count) : null
                })),
                debug: {
                    sqlQueryTime: sqlEndTime - sqlStartTime,
                    apiTime: apiEndTime - apiStartTime
                }
            }
        } catch (error) {
            console.error("Error fetching data:", error);
            set.status = 500;
            return { message: "Error fetching data" };
        }
    }, {
        permission: "charts.list",
        query: t.Object({
            startDate: t.String(),
            endDate: t.String(),
            organization: t.Optional(t.String()),
            terminals: t.Optional(t.String()),
        }),
    })
