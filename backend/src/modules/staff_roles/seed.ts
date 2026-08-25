import { drizzleDb } from "../../lib/db";
import { staff_roles } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { SEED_ROLES } from "./catalog";

// Засев справочника ролей. Идемпотентен по code — тот же приём, что у
// attestation/seed-permissions.ts и passport/seed-permissions.ts: существующую
// строку не трогаем, потому что её мог поправить HR (переименовать по-узбекски,
// поменять порядок, отключить). Сид отвечает за то, что роль ЕСТЬ, а не за то,
// как она выглядит сегодня.

async function main() {
  for (const r of SEED_ROLES) {
    const existing = await drizzleDb
      .select({ id: staff_roles.id })
      .from(staff_roles)
      .where(eq(staff_roles.code, r.code))
      .execute();
    if (existing.length) {
      console.log(`skip ${r.code} (exists)`);
      continue;
    }
    await drizzleDb.insert(staff_roles).values(r).execute();
    console.log(`inserted ${r.code}`);
  }
  console.log("done");
  process.exit(0);
}

main();
