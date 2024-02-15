const dotenv = require('dotenv');
var cron = require('node-cron');
import { Database } from "duckdb-async";
import { env } from 'hono/adapter'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getToken } from "./token";
import { syncTerminal } from "./syncs/terminal";
import { getTransportToken } from "./transportToken";
import { syncOrganizations } from "./syncs/organization";
import { syncCategories } from "./syncs/categories";
import { syncProducts } from "./syncs/products";
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid';
const dayjs = require('dayjs')

dotenv.config();




(async () => {
  const db = await Database.create(process.env.DUCK_PATH!);
  const syncAlldata = async () => {
    // running syncs in startup

    const token = await getToken();

    const {
      lesToken,
      choparToken
    } = await getTransportToken();

    await syncTerminal(db, lesToken, choparToken);

    await syncOrganizations(db, lesToken, choparToken);

    await syncCategories(db, token);

    await syncProducts(db, token);


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
    `)
  }
  const app = new Hono()

  // await syncAlldata();


  cron.schedule('0 1/* * * *', async () => {
    // running syncs every hour
    await syncAlldata();
  });

  app.get('/', async (c) => {
    return c.text('Hello, world!')
  })

  app.post('/stoplist/list', zValidator(
    'json',
    z.object({
      limit: z.number(),
      offset: z.number(),
      filter: z.array(z.object({
        field: z.string(),
        operator: z.string(),
        value: z.string()
      })),

    })
  ), async (c) => {
    const {
      limit,
      offset,
      filter
    } = await c.req.json();
    let where = '';

    if (filter.length > 0) {
      where = `WHERE ${filter.map((item: any) => {
        switch (item.operator) {
          case 'contains':
            return `${item.field} LIKE '%${item.value}%'`
          case 'eq':
            return `${item.field} = '${item.value}'`
          case 'gt':
            return `${item.field} > '${item.value}'`
          case 'lt':
            return `${item.field} < '${item.value}'`
          case 'gte':
            return `${item.field} >= '${item.value}'`
          case 'lte':
            return `${item.field} <= '${item.value}'`
          default:
            return `${item.field} ${item.operator} '${item.value}'`
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
    console.log('stoplist count', count)



    return c.json({
      data: data,
      total: Number(count[0].cnt)
    });
  });

  app.post('/stoplist', zValidator(
    'json',
    z.object({
      stops: z.array(z.object({
        terminalId: z.string(),
        productId: z.string(),
        dateAdd: z.string()
      }))
    })
  ), async (c) => {
    // console.log('stop body', c.req.json())
    const {
      stops
    } = await c.req.json();


    const terminalId = stops[0].terminalId;

    const terminal = (await db.all(`SELECT * FROM terminal WHERE id = '${terminalId}'`))[0];

    // console.log('terminal', terminal)

    const sqlQuery = `SELECT * FROM stoplist WHERE status = 'stop'`;

    const data = await db.all(sqlQuery);
    // console.log('data', data);

    // create two arrays. First should contain all items from stop that doesn't exist in data. Second should contain all items from data that doesn't exist in stop. Check by terminalId and productId
    const toAdd = stops.filter((stop: any) => !data.some((item: any) => item.terminalId === stop.terminalId && item.productId === stop.productId));
    const toRemove = data.filter((item: any) => !stops.some((stop: any) => stop.terminalId === item.terminalId && stop.productId === item.productId));
    console.log('toAdd', toAdd);
    const insertQuery = `
      ${toAdd.map((item: any) => {
      const date = new Date(item.dateAdd);
      date.setHours(date.getHours() + 5);
      return `INSERT INTO stoplist (id, productId, terminalId, dateAdd, status, organizationId, solve_status) VALUES ('${uuidv4()}', '${item.productId}', '${item.terminalId}', '${date.toISOString()}', 'stop', '${terminal.organizationId}', 'new')`
    }).join('; ')};
    `;

    const removeQuery = `
      ${toRemove.map((item: any) => {
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
  })

  const port = 9999
  console.log(`Server is running on port ${port}`)

  serve({
    fetch: app.fetch,
    port
  })
  // export default {
  //   port: port,
  //   fetch: app.fetch,
  // }


})()
