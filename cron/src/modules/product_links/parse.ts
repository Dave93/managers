// Pure helpers for product_links_sync.ts (exord → managers branch/product
// reference). Kept free of I/O so they are unit-testable.

export type ExordStore = {
  user_id: number;
  name: string;
  terminal_iiko_id: string | null;
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
    const ids: string[] = [];
    for (const p of s.product_ids) {
      const id = normUuid(p);
      if (!id) throw new Error(`stores[${i}] has a bad product id: ${String(p)}`);
      ids.push(id);
    }
    return {
      user_id: Number(s.user_id),
      name: String(s.name ?? ""),
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

export type TerminalLinks = { terminal_id: string; product_ids: string[] };

// Куда попал каждый магазин exord: снимок для страницы «Сопоставление exord».
export type StoreAssignment = {
  user_id: number;
  name: string;
  terminal_iiko_id: string | null;
  product_count: number;
  terminal_id: string | null;
  source: "override" | "iiko" | null;
};

// Maps exord stores to managers terminals.id. A manual override (exord
// user_id → terminal, set by the office in the admin) wins over the store's
// iiko id, so a wrong or missing iiko id in exord can be fixed from managers.
// Otherwise the iiko id is used; stores that resolve to nothing are skipped.
// If two stores resolve to the same terminal their products are unioned.
export function mapToTerminals(
  stores: ExordStore[],
  terminalByIikoId: Map<string, string>,
  overrides: Map<number, string> = new Map()
): { rows: TerminalLinks[]; skipped: number; assignments: StoreAssignment[] } {
  const byTerminal = new Map<string, Set<string>>();
  const assignments: StoreAssignment[] = [];
  let skipped = 0;
  for (const s of stores) {
    const override = overrides.get(s.user_id);
    const byIiko = s.terminal_iiko_id ? terminalByIikoId.get(s.terminal_iiko_id) : undefined;
    const terminalId = override ?? byIiko ?? null;
    assignments.push({
      user_id: s.user_id,
      name: s.name,
      terminal_iiko_id: s.terminal_iiko_id,
      product_count: s.product_ids.length,
      terminal_id: terminalId,
      source: override ? "override" : byIiko ? "iiko" : null,
    });
    if (!terminalId) {
      skipped++;
      continue;
    }
    const set = byTerminal.get(terminalId) ?? new Set<string>();
    for (const p of s.product_ids) set.add(p);
    byTerminal.set(terminalId, set);
  }
  const rows = [...byTerminal]
    .map(([terminal_id, set]) => ({ terminal_id, product_ids: [...set].sort() }))
    .sort((a, b) => a.terminal_id.localeCompare(b.terminal_id));
  return { rows, skipped, assignments };
}

// Отпечаток сопоставления: синк переписывает таблицу, если он изменился,
// даже когда версия exord та же (офис поменял ручное сопоставление).
export function mappingFingerprint(assignments: StoreAssignment[]): string {
  return assignments
    .map((a) => `${a.user_id}:${a.terminal_id ?? "-"}`)
    .sort()
    .join(",");
}

export const countLinks = (rows: TerminalLinks[]) =>
  rows.reduce((n, r) => n + r.product_ids.length, 0);

// Refuses to replace the table with something that looks like garbage.
// `current` is the links count of the stored snapshot (0 on first sync).
export const MAX_DROP_RATIO = 0.5;

export function checkGuard(
  rows: TerminalLinks[],
  current: { terminals: number; links: number },
  force = false
): string | null {
  if (rows.length === 0) return "no stores mapped to a managers terminal";
  const links = countLinks(rows);
  if (links === 0) return "all mapped stores have zero products";
  if (!force && current.links > 0 && links < current.links * (1 - MAX_DROP_RATIO)) {
    return `links dropped ${current.links} -> ${links} (> ${MAX_DROP_RATIO * 100}%), use --force`;
  }
  return null;
}
