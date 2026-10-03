// Pure helpers for product_links_sync.ts (exord → managers branch/product
// reference). Kept free of I/O so they are unit-testable.

export type ExordStore = {
  user_id: number;
  name: string;
  store_iiko_id: string | null;
  terminal_iiko_id: string | null; // informational only, not a key
  product_ids: string[];
};

export type ExordPayload = {
  version: string;
  generated_at: string | null;
  stores: ExordStore[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const normUuid = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return UUID_RE.test(s) ? s : null;
};

// Throws on anything that is not the agreed contract, so a broken response
// never reaches the database.
export function parsePayload(raw: unknown): ExordPayload {
  const o = raw as any;
  if (!o || typeof o !== "object") throw new Error("payload is not an object");
  if (typeof o.version !== "string" || !o.version) throw new Error("missing version");
  if (!Array.isArray(o.stores)) throw new Error("stores is not an array");

  const stores: ExordStore[] = o.stores.map((s: any, i: number) => {
    if (!s || typeof s !== "object") throw new Error(`stores[${i}] is not an object`);
    if (!Array.isArray(s.product_ids)) throw new Error(`stores[${i}].product_ids is not an array`);
    let terminal: string | null = null;
    if (s.terminal_iiko_id != null) {
      terminal = normUuid(s.terminal_iiko_id);
      if (!terminal) throw new Error(`stores[${i}].terminal_iiko_id is not a uuid`);
    }
    let store: string | null = null;
    if (s.store_iiko_id != null) {
      store = normUuid(s.store_iiko_id);
      if (!store) throw new Error(`stores[${i}].store_iiko_id is not a uuid`);
    }
    const ids: string[] = [];
    for (const p of s.product_ids) {
      const id = normUuid(p);
      if (!id) throw new Error(`stores[${i}] has a bad product id: ${String(p)}`);
      ids.push(id);
    }
    return {
      user_id: Number(s.user_id),
      name: String(s.name ?? ""),
      store_iiko_id: store,
      terminal_iiko_id: terminal,
      product_ids: ids,
    };
  });

  return {
    version: o.version,
    generated_at: typeof o.generated_at === "string" ? o.generated_at : null,
    stores,
  };
}

export type StoreLinks = { store_id: string; product_ids: string[] };

export type UnknownStore = { user_id: number; name: string; store_iiko_id: string };

// Maps exord stores to managers corporation_store.id (the same iiko store
// uuid). Entries without a store id are counted in `noStore`; entries whose
// store is missing from corporation_store are listed in `unknown`. If two
// entries share a store their products are unioned.
export function mapToStores(
  stores: ExordStore[],
  knownStoreIds: Set<string>
): { rows: StoreLinks[]; noStore: number; unknown: UnknownStore[] } {
  const byStore = new Map<string, Set<string>>();
  const unknown: UnknownStore[] = [];
  let noStore = 0;
  for (const s of stores) {
    if (!s.store_iiko_id) {
      noStore++;
      continue;
    }
    if (!knownStoreIds.has(s.store_iiko_id)) {
      unknown.push({ user_id: s.user_id, name: s.name, store_iiko_id: s.store_iiko_id });
      continue;
    }
    const set = byStore.get(s.store_iiko_id) ?? new Set<string>();
    for (const p of s.product_ids) set.add(p);
    byStore.set(s.store_iiko_id, set);
  }
  const rows = [...byStore].map(([store_id, set]) => ({
    store_id,
    product_ids: [...set].sort(),
  }));
  return { rows, noStore, unknown };
}

export const countLinks = (rows: StoreLinks[]) =>
  rows.reduce((n, r) => n + r.product_ids.length, 0);

// Refuses to replace the table with something that looks like garbage.
// `current` is the links count of the stored snapshot (0 on first sync).
export const MAX_DROP_RATIO = 0.5;

export function checkGuard(
  rows: StoreLinks[],
  current: { stores: number; links: number },
  force = false
): string | null {
  if (rows.length === 0) return "no exord stores mapped to a managers store";
  const links = countLinks(rows);
  if (links === 0) return "all mapped stores have zero products";
  if (!force && current.links > 0 && links < current.links * (1 - MAX_DROP_RATIO)) {
    return `links dropped ${current.links} -> ${links} (> ${MAX_DROP_RATIO * 100}%), use --force`;
  }
  return null;
}
