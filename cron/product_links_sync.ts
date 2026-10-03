/**
 * Sync the "which branch orders which products" reference from exord into
 * managers (terminal_product_links + product_links_meta), then drop the Redis
 * read cache.
 *
 * Usage (from /home/davr/managers/cron, env from ./.env):
 *   ./product_links_sync              # fetch from exord, swap tables if changed
 *   ./product_links_sync --force      # also swap if version is unchanged / links dropped a lot
 *   ./product_links_sync --dry-run    # fetch + validate + report, write nothing
 *   ./product_links_sync --file x.json  # use a saved payload instead of HTTP
 *
 * Env: EXORD_API_URL, EXORD_API_TOKEN (+ DATABASE_URL, PROJECT_PREFIX).
 * Crontab: every 15 min, single instance, log to a file:
 *   *\/15 * * * * cd /home/davr/managers/cron/ && flock -n /tmp/product_links_sync.lock ./product_links_sync >> /var/log/product_links_sync.log 2>&1
 *
 * Spec: docs/superpowers/specs/2026-10-03-product-links-sync-design.md
 */
import { readFileSync } from "node:fs";
import { drizzleDb } from "@backend/lib/db";
import { product_links_meta, terminal_product_links } from "backend/drizzle/schema";
import { sql } from "drizzle-orm";
import { invalidateProductLinksCache } from "@backend/modules/product_links/service";
import client from "./src/redis";
import { loadTerminalByIikoId } from "./src/modules/terminals_by_iiko";
import {
  checkGuard,
  countLinks,
  mapToTerminals,
  parsePayload,
  type ExordPayload,
} from "./src/modules/product_links/parse";

const log = (msg: string) => console.log(`${new Date().toISOString()} product_links_sync: ${msg}`);

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY = argv.includes("--dry-run");
const fileIdx = argv.indexOf("--file");
const FILE = fileIdx >= 0 ? argv[fileIdx + 1] : undefined;

async function fetchPayload(): Promise<ExordPayload> {
  if (FILE) return parsePayload(JSON.parse(readFileSync(FILE, "utf8")));

  const base = process.env.EXORD_API_URL?.replace(/\/+$/, "");
  const token = process.env.EXORD_API_TOKEN;
  if (!base || !token) throw new Error("EXORD_API_URL / EXORD_API_TOKEN are not set");

  const res = await fetch(`${base}/api/product-links`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`exord responded ${res.status}`);
  return parsePayload(await res.json());
}

async function main() {
  const payload = await fetchPayload();
  const mapped = mapToTerminals(payload.stores, await loadTerminalByIikoId());
  const links = countLinks(mapped.rows);

  const metaRes: any = await drizzleDb.execute(
    sql`SELECT version, terminals_count, links_count FROM product_links_meta WHERE id = 1`
  );
  const meta = (Array.isArray(metaRes) ? metaRes : metaRes?.rows ?? [])[0];
  log(
    `exord version=${payload.version} stores=${payload.stores.length} ` +
      `mapped=${mapped.rows.length} skipped=${mapped.skipped} links=${links}`
  );

  if (!FORCE && meta && meta.version === payload.version && meta.terminals_count === mapped.rows.length) {
    log("unchanged, nothing to do");
    return;
  }

  const refusal = checkGuard(
    mapped.rows,
    { terminals: meta?.terminals_count ?? 0, links: meta?.links_count ?? 0 },
    FORCE
  );
  if (refusal) throw new Error(`refusing to replace data: ${refusal}`);

  if (DRY) {
    log("dry-run, nothing written");
    return;
  }

  await drizzleDb.transaction(async (tx) => {
    await tx.delete(terminal_product_links);
    for (let i = 0; i < mapped.rows.length; i += 100) {
      await tx.insert(terminal_product_links).values(mapped.rows.slice(i, i + 100));
    }
    await tx
      .insert(product_links_meta)
      .values({
        id: 1,
        version: payload.version,
        generated_at: payload.generated_at,
        terminals_count: mapped.rows.length,
        links_count: links,
      })
      .onConflictDoUpdate({
        target: product_links_meta.id,
        set: {
          version: payload.version,
          generated_at: payload.generated_at,
          terminals_count: mapped.rows.length,
          links_count: links,
          synced_at: sql`now()`,
        },
      });
  });
  log(`replaced: ${mapped.rows.length} terminals, ${links} links`);

  // The tables are already swapped; a Redis hiccup only means stale reads
  // until the 15 min TTL runs out.
  try {
    const deleted = await Promise.race([
      invalidateProductLinksCache(client),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("redis timeout")), 10_000)),
    ]);
    log(`redis cache cleared (${deleted} keys)`);
  } catch (e) {
    log(`WARN redis cache not cleared: ${(e as Error).message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    log(`ERROR ${(e as Error).message}`);
    process.exit(1);
  });
