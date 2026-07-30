import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../drizzle/schema";

// Dedicated postgres-js handle for the credit module — do NOT reuse lib/db.ts's
// shared `drizzleDb` here.
//
// service.ts's raw `db.execute(sql\`...\`)` calls treat the result as an array
// (`.length`, `[0]` indexing, `.map()`). That holds under drizzle-orm/postgres-js
// (what this file and the Task 2/3 test suites use — postgres-js's
// `client.unsafe()` result extends Array) but NOT under drizzle-orm/node-postgres
// (lib/db.ts's `drizzleDb`), where `db.execute()` returns a raw pg.QueryResult
// object (`{rows, rowCount, ...}`), not an array. Verified empirically:
// `await drizzleDb.execute(sql\`SELECT 1 AS x\`)` gives Array.isArray === false,
// .length === undefined, .rows.length === 1. Wiring the credit module to
// lib/db.ts's drizzleDb would silently break every authorize/capture/void/refund
// call (TypeErrors on array access, swallowed by service.ts's catch blocks as
// `service_error`).
//
// Scoping a dedicated handle here — instead of changing lib/db.ts (44 controllers
// depend on its node-postgres result shape) or rewriting service.ts's ~20
// raw-execute call sites — keeps the Task 2/3 test suites (which already run
// against postgres-js) valid evidence for production behavior. Any code calling
// into modules/credit/service.ts MUST go through this handle, not lib/db.ts's
// drizzleDb.
let clientInstance: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getCreditDb() {
  if (!dbInstance) {
    clientInstance = postgres(process.env.DATABASE_URL!, { max: 5 });
    dbInstance = drizzle(clientInstance, { schema });
  }
  return dbInstance;
}

export const creditDb = getCreditDb();
