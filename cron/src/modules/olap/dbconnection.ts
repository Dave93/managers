import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

let client = new Client(process.env.DATABASE_URL);
await client.connect();
const db = drizzle(client);

export default db;
export type DB = typeof db;
export const closeConnection = async () => {
    await client.end();
    client = null;
}
