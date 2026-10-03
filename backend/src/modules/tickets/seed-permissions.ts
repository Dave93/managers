import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

// description — varchar(60), длиннее не влезет.
const SLUGS: { slug: string; description: string }[] = [
  { slug: "tickets.create", description: "Заявки: создание с планшета" },
  { slug: "tickets.list", description: "Заявки: список своих филиалов" },
  { slug: "tickets.close", description: "Заявки: приёмка и возврат в работу" },
  { slug: "tickets.cancel", description: "Заявки: отмена" },
  { slug: "tickets.list_all", description: "Заявки: раздел офиса, все филиалы" },
  { slug: "tickets.payment.approve", description: "Заявки: утверждение сумм" },
  { slug: "tickets.types.manage", description: "Заявки: типы и схемы полей" },
  { slug: "tickets.contractors.manage", description: "Заявки: фирмы и исполнители" },
];

async function main() {
  for (const s of SLUGS) {
    const existing = await drizzleDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.slug, s.slug))
      .execute();
    if (existing.length) {
      console.log(`skip ${s.slug} (exists)`);
      continue;
    }
    await drizzleDb.insert(permissions).values({ slug: s.slug, description: s.description, active: true }).execute();
    console.log(`inserted ${s.slug}`);
  }
  console.log("done");
  process.exit(0);
}

main();
