"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require('dotenv');
var cron = require('node-cron');
const duckdb_async_1 = require("duckdb-async");
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const token_1 = require("./token");
const terminal_1 = require("./syncs/terminal");
const transportToken_1 = require("./transportToken");
const organization_1 = require("./syncs/organization");
const categories_1 = require("./syncs/categories");
const products_1 = require("./syncs/products");
const zod_validator_1 = require("@hono/zod-validator");
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const dayjs = require('dayjs');
dotenv.config();
(async () => {
    const db = await duckdb_async_1.Database.create(process.env.DUCK_PATH);
    const syncAlldata = async () => {
        // running syncs in startup
        const token = await (0, token_1.getToken)();
        const { lesToken, choparToken } = await (0, transportToken_1.getTransportToken)();
        await (0, terminal_1.syncTerminal)(db, lesToken, choparToken);
        await (0, organization_1.syncOrganizations)(db, lesToken, choparToken);
        await (0, categories_1.syncCategories)(db, token);
        await (0, products_1.syncProducts)(db, token);
        await db.exec(`
    CREATE TABLE IF NOT EXISTS "stoplist" (
        "id" UUID PRIMARY KEY,
        "productId" UUID,
        "terminalId" UUID,
        "organizationId" UUID,
        "dateAdd" TIMESTAMP,
        "dateRemoved" TIMESTAMP,
        "status" STRING,
        "difference" INTEGER,
        "reason" STRING,
        "responsible" STRING,
        "comment" TEXT,
        "solve_status" STRING

    );
    `);
    };
    const app = new hono_1.Hono();
    // await syncAlldata();
    cron.schedule('0 1/* * * *', async () => {
        // running syncs every hour
        await syncAlldata();
    });
    app.get('/', async (c) => {
        return c.text('Hello, world!');
    });
    app.post('/stoplist/list', (0, zod_validator_1.zValidator)('json', zod_1.z.object({
        limit: zod_1.z.number(),
        offset: zod_1.z.number(),
        filter: zod_1.z.array(zod_1.z.object({
            field: zod_1.z.string(),
            operator: zod_1.z.string(),
            value: zod_1.z.string()
        })),
    })), async (c) => {
        const { limit, offset, filter } = await c.req.json();
        let where = '';
        if (filter.length > 0) {
            where = `WHERE ${filter.map((item) => {
                switch (item.operator) {
                    case 'contains':
                        return `${item.field} LIKE '%${item.value}%'`;
                    case 'eq':
                        return `${item.field} = '${item.value}'`;
                    case 'gt':
                        return `${item.field} > '${item.value}'`;
                    case 'lt':
                        return `${item.field} < '${item.value}'`;
                    case 'gte':
                        return `${item.field} >= '${item.value}'`;
                    case 'lte':
                        return `${item.field} <= '${item.value}'`;
                    default:
                        return `${item.field} ${item.operator} '${item.value}'`;
                }
            }).join(' AND ')}`;
        }
        const sqlQuery = `
      SELECT
      stoplist.*,
      terminal.name as terminalName,
      categories.name as categoryName,
      products.name as productName
      FROM stoplist
      LEFT JOIN terminal ON terminal.id = stoplist.terminalId
      LEFT JOIN products ON products.id = stoplist.productId
      LEFT JOIN categories ON categories.id = products.category
      ${where}
      ORDER BY status DESC, dateAdd DESC
      LIMIT ${limit}
      OFFSET ${offset};
    `;
        console.log('query', sqlQuery);
        const sqlCount = `
       SELECT count(*) as cnt FROM
      stoplist
      LEFT JOIN terminal ON terminal.id = stoplist.terminalId
      LEFT JOIN products ON products.id = stoplist.productId
      LEFT JOIN categories ON categories.id = products.category
      ${where};
    `;
        const data = await db.all(sqlQuery);
        const count = await db.all(sqlCount);
        // console.log('stoplist data', data)
        console.log('stoplist count', count);
        return c.json({
            data: data,
            total: Number(count[0].cnt)
        });
    });
    app.post('/stoplist', (0, zod_validator_1.zValidator)('json', zod_1.z.object({
        stops: zod_1.z.array(zod_1.z.object({
            terminalId: zod_1.z.string(),
            productId: zod_1.z.string(),
            dateAdd: zod_1.z.string()
        }))
    })), async (c) => {
        // console.log('stop body', c.req.json())
        const { stops } = await c.req.json();
        const terminalId = stops[0].terminalId;
        const terminal = (await db.all(`SELECT * FROM terminal WHERE id = '${terminalId}'`))[0];
        // console.log('terminal', terminal)
        const sqlQuery = `SELECT * FROM stoplist WHERE status = 'stop'`;
        const data = await db.all(sqlQuery);
        // console.log('data', data);
        // create two arrays. First should contain all items from stop that doesn't exist in data. Second should contain all items from data that doesn't exist in stop. Check by terminalId and productId
        const toAdd = stops.filter((stop) => !data.some((item) => item.terminalId === stop.terminalId && item.productId === stop.productId));
        const toRemove = data.filter((item) => !stops.some((stop) => stop.terminalId === item.terminalId && stop.productId === item.productId));
        console.log('toAdd', toAdd);
        const insertQuery = `
      ${toAdd.map((item) => {
            const date = new Date(item.dateAdd);
            date.setHours(date.getHours() + 5);
            return `INSERT INTO stoplist (id, productId, terminalId, dateAdd, status, organizationId, solve_status) VALUES ('${(0, uuid_1.v4)()}', '${item.productId}', '${item.terminalId}', '${date.toISOString()}', 'stop', '${terminal.organizationId}', 'new')`;
        }).join('; ')};
    `;
        const removeQuery = `
      ${toRemove.map((item) => {
            const difference = dayjs().diff(dayjs(item.dateAdd), 'minute');
            return `UPDATE stoplist SET status = 'available', dateRemoved = '${dayjs().toISOString()}', difference = ${difference} WHERE id = '${item.id}'`;
        }).join('; ')};
    `;
        if (toAdd.length > 0) {
            console.log('insertQuery', insertQuery);
            await db.all(insertQuery);
        }
        if (toRemove.length > 0) {
            console.log('removeQuery', removeQuery);
            await db.all(removeQuery);
        }
        console.log('trying to response some data');
        return c.json({
            success: true
        });
    });
    const port = 9999;
    console.log(`Server is running on port ${port}`);
    (0, node_server_1.serve)({
        fetch: app.fetch,
        port
    });
    // export default {
    //   port: port,
    //   fetch: app.fetch,
    // }
})();
