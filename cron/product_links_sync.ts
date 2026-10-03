/**
 * Sync the "which branch orders which products" reference from exord into
 * managers (store_product_links + product_links_meta), keyed by iiko store
 * uuid (= corporation_store.id), then drop the Redis read cache.
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
import { product_links_meta, store_product_links } from "backend/drizzle/schema";
import { sql } from "drizzle-orm";
import { invalidateProductLinksCache } from "@backend/modules/product_links/service";
import client from "./src/redis";
import {
  checkGuard,
  countLinks,
  mapToStores,
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

// Every iiko store uuid we know (corporation_store.id).
async function loadKnownStoreIds(): Promise<Set<string>> {
  const res: any = await drizzleDb.execute(sql`SELECT id FROM corporation_store`);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? [];
  return new Set(rows.map((r) => String(r.id).toLowerCase()));
}

async function main() {
  const payload = await fetchPayload();
  const mapped = mapToStores(payload.stores, await loadKnownStoreIds());
  const links = countLinks(mapped.rows);

  // Compare against what is actually stored, not the meta row: right after
  // the terminal -> store switch the meta still describes the old table.
  const curRes: any = await drizzleDb.execute(sql`
    SELECT (SELECT version FROM product_links_meta WHERE id = 1) AS version,
           count(*)::int AS stores,
           coalesce(sum(cardinality(product_ids)), 0)::int AS links
    FROM store_product_links`);
  const current = (Array.isArray(curRes) ? curRes : curRes?.rows ?? [])[0] ?? {
    version: null,
    stores: 0,
    links: 0,
  };
  log(
    `exord version=${payload.version} stores=${payload.stores.length} ` +
      `mapped=${mapped.rows.length} no_store=${mapped.noStore} unknown_store=${mapped.unknown.length} links=${links}`
  );
  for (const u of mapped.unknown) {
    log(`WARN store not in corporation_store: user_id=${u.user_id} "${u.name}" ${u.store_iiko_id}`);
  }

  if (
    !FORCE &&
    current.version === payload.version &&
    current.stores === mapped.rows.length &&
    current.links === links
  ) {
    log("unchanged, nothing to do");
    return;
  }

  const refusal = checkGuard(
    mapped.rows,
    { stores: current.stores, links: current.links },
    FORCE
  );
  if (refusal) throw new Error(`refusing to replace data: ${refusal}`);

  if (DRY) {
    log("dry-run, nothing written");
    return;
  }

  await drizzleDb.transaction(async (tx) => {
    await tx.delete(store_product_links);
    for (let i = 0; i < mapped.rows.length; i += 100) {
      await tx.insert(store_product_links).values(mapped.rows.slice(i, i + 100));
    }
    await tx
      .insert(product_links_meta)
      .values({
        id: 1,
        version: payload.version,
        generated_at: payload.generated_at,
        stores_count: mapped.rows.length,
        links_count: links,
      })
      .onConflictDoUpdate({
        target: product_links_meta.id,
        set: {
          version: payload.version,
          generated_at: payload.generated_at,
          stores_count: mapped.rows.length,
          links_count: links,
          synced_at: sql`now()`,
        },
      });
  });
  log(`replaced: ${mapped.rows.length} stores, ${links} links`);

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
