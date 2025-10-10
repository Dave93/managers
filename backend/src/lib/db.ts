import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@backend/../drizzle/schema";
console.log('process.env.DATABASE_URL', process.env.DATABASE_URL)
import { Pool } from "pg";


let poolInstance: Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

const getPool = () => {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return poolInstance;
};

export function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    const pool = getPool();
    dbInstance = drizzle(pool, {
      schema: schema,
    });
  }
  return dbInstance;
}

export const drizzleDb = getDb();

export type DrizzleDB = ReturnType<typeof getDb>;


// Graceful shutdown function
export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
  }
}
