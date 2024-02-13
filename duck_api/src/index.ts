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
import dayjs from "dayjs";

dotenv.config();




// (async () => {
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
    return `INSERT INTO stoplist (id, productId, terminalId, dateAdd, status, organizationId, solve_status) VALUES ('${uuidv4()}', '${item.productId}', '${item.terminalId}', '${dayjs().add(5, 'hour').toISOString()}', 'stop', '${terminal.organizationId}', 'new')`
  }).join('; ')};
    `;

  const removeQuery = `
      ${toRemove.map((item: any) => {
    const difference = dayjs().add(5, 'hour').diff(dayjs(item.dateAdd), 'minute');
    return `UPDATE stoplist SET status = 'available', dateRemoved = '${dayjs().add(5, 'hour').toISOString()}', difference = ${difference} WHERE id = '${item.id}'`;
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

// serve({
//   fetch: app.fetch,
//   port
// })
export default {
  port: port,
  fetch: app.fetch,
}


// })()
