import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

// description — varchar(60), длиннее не влезет.
const SLUGS: { slug: string; description: string }[] = [
  { slug: "kpi_layout", description: "KPI: раздел в меню" },
  { slug: "kpi.evaluate", description: "KPI: оценки и нарушения по назначениям" },
  { slug: "kpi.view", description: "KPI: просмотр оценок, нарушений, споров" },
  { slug: "kpi.manage", description: "KPI: карты, оценщики, настройки, импорт" },
  { slug: "kpi.approve", description: "KPI: закрытие месяца, споры, повышения" },
];

async function main() {
  for (const s of SLUGS) {
    if (s.description.length > 60) throw new Error(`${s.slug}: description длиннее 60 знаков`);
  }
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
