import { drizzleDb } from "@backend/lib/db";
import { sql } from "drizzle-orm";
import { normUuid } from "./product_links/parse";

// Общий для cron-синков (product_links_sync, store_terminal_sync).
// iiko terminal uuid -> managers terminals.id. Joined to terminals because
// credentials also keeps rows of deleted terminals (same iiko key twice).
export async function loadTerminalByIikoId(): Promise<Map<string, string>> {
  const res: any = await drizzleDb.execute(sql`
    SELECT c.key, t.id AS terminal_id
    FROM credentials c
    JOIN terminals t ON t.id::text = c.model_id
    WHERE c.model = 'terminals' AND c.type = 'iiko_id'`);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? [];
  const map = new Map<string, string>();
  for (const r of rows) {
    const key = normUuid(r.key);
    if (key) map.set(key, String(r.terminal_id));
  }
  return map;
}

