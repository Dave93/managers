import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

const SLUGS: { slug: string; description: string }[] = [
  { slug: "tests.list", description: "Attestation: list tests" },
  { slug: "tests.one", description: "Attestation: view a test" },
  { slug: "tests.add", description: "Attestation: create test" },
  { slug: "tests.edit", description: "Attestation: edit test + questions" },
  { slug: "tests.delete", description: "Attestation: delete test" },
  { slug: "employees.list", description: "Attestation: list employees" },
  { slug: "employees.one", description: "Attestation: view employee" },
  { slug: "employees.add", description: "Attestation: create employee" },
  { slug: "employees.edit", description: "Attestation: edit employee" },
  { slug: "employees.delete", description: "Attestation: delete employee" },
  { slug: "attestation.run", description: "Attestation: launch + take tests (kiosk)" },
  { slug: "attestation.reset", description: "Attestation: reset an attempt (HQ)" },
  { slug: "attestation.analytics", description: "Attestation: view analytics" },
  { slug: "attestation_layout", description: "Attestation: top-level admin layout" },
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
