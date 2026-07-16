import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

const SLUGS: { slug: string; description: string }[] = [
  { slug: "medical_layout", description: "Medical: top-level layout/section" },
  { slug: "medical.list", description: "Medical: view exam statuses" },
  { slug: "medical.edit", description: "Medical: manage schedules + mark exams" },
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
