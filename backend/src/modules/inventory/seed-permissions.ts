import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

// description — varchar(60), длиннее не влезет.
const SLUGS: { slug: string; description: string }[] = [
  { slug: "inventory.count", description: "Инвентаризация: ввод остатков своих складов" },
  { slug: "inventory.manage", description: "Инвентаризация: начать, отправить, вернуть" },
  { slug: "inventory.templates", description: "Инвентаризация: шаблоны, обзор всех складов" },
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
