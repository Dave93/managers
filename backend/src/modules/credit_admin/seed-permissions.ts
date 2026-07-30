import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

const SLUGS: { slug: string; description: string }[] = [
  { slug: "credit.list", description: "Кредитные компании: просмотр и выписка" },
  { slug: "credit.edit", description: "Кредитные компании: CRUD, телефоны, документы" },
  { slug: "credit.pay", description: "Кредитные компании: погашения и корректировки" },
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
    await drizzleDb
      .insert(permissions)
      .values({ slug: s.slug, description: s.description, active: true })
      .execute();
    console.log(`inserted ${s.slug}`);
  }
  console.log("done");
  process.exit(0);
}

main();
