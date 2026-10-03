import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

const SLUGS: { slug: string; description: string }[] = [
  { slug: "passport.curriculum.edit", description: "Passport: edit own-department curriculum" },
  { slug: "passport.curriculum.publish", description: "Passport: review + publish curriculum (HR)" },
  { slug: "passport.signoff", description: "Passport: sign trainee observations (mentor)" },
  { slug: "passport.enrollments.manage", description: "Passport: start/close enrollments, invites (HR)" },
  { slug: "passport.matrix.view", description: "Passport: view progress matrix" },
  { slug: "passport.recheck", description: "Passport: perform rechecks (audit)" },
  { slug: "passport.level4.grant", description: "Passport: grant level 4 (can teach)" },
  { slug: "passport.mentors.manage", description: "Passport: bind mentor telegram accounts" },
  { slug: "passport_layout", description: "Passport: top-level admin layout" },
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
