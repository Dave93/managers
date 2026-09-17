import { sql, type SQL } from "drizzle-orm";

export type ChartScope = {
  /** iiko restaurant_group ids the query may touch; empty + restricted = nothing */
  iikoIds: string[];
  /** true when the result must be limited (viewer restriction or explicit filter) */
  restricted: boolean;
  /** true when the viewer themself is limited (terminals attached or franchise role) */
  viewerRestricted: boolean;
  /** iiko ids of the viewer's own terminals (∩ filter when a filter is given) */
  ownIikoIds: string[];
};

type CachedTerminal = {
  id: string;
  credentials?: { type: string; key: string }[] | null;
};

const iikoIdOf = (terminal: CachedTerminal): string | undefined =>
  terminal.credentials?.find((c) => c.type === "iiko_id")?.key || undefined;

// A viewer with terminals attached, or any franchise manager, is limited to
// their own terminals. Having none must mean "nothing", never "everything":
// an empty list used to be read as unrestricted.
export function resolveChartScope(
  cachedTerminals: CachedTerminal[],
  terminalsParam: string | undefined,
  userTerminals: string[] | undefined,
  roleCode: string | null | undefined,
): ChartScope {
  const wanted = (terminalsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const own = Array.isArray(userTerminals) ? userTerminals : [];
  const viewerRestricted = own.length > 0 || roleCode === "franchise_manager";
  const restricted = viewerRestricted || wanted.length > 0;

  const inWanted = (t: CachedTerminal) => wanted.length === 0 || wanted.includes(t.id);
  const inOwn = (t: CachedTerminal) => !viewerRestricted || own.includes(t.id);

  const iikoIds: string[] = [];
  const ownIikoIds: string[] = [];
  for (const t of cachedTerminals) {
    const iiko = iikoIdOf(t);
    if (!iiko || !inWanted(t)) continue;
    if (inOwn(t)) iikoIds.push(iiko);
    if (viewerRestricted && own.includes(t.id)) ownIikoIds.push(iiko);
  }
  return { iikoIds, restricted, viewerRestricted, ownIikoIds };
}

export function terminalCondition(scope: ChartScope, column: SQL = sql`restaurant_group_id`): SQL {
  if (!scope.restricted) return sql``;
  if (scope.iikoIds.length === 0) return sql`AND false`;
  return sql`AND ${column} IN (${sql.join(scope.iikoIds.map((id) => sql`${id}`), sql`, `)})`;
}

type RankedRow<K extends string> = {
  name: string;
  rank: number;
  restaurant_group_id: string;
  department_id: string;
} & Record<K, number | null>;

export type MaskedRow<K extends string> = { name: string; rank: number; own: boolean } & Record<K, number | null>;

// Branch ranking across the network. ownIikoIds null = unrestricted viewer:
// every row is theirs. Otherwise other branches keep name and rank but lose
// their numbers, and no row carries its ids.
export function maskRanking<K extends string>(
  rows: RankedRow<K>[],
  ownIikoIds: string[] | null,
  valueKeys: readonly K[],
): { data: MaskedRow<K>[]; total: number; own_brands: string[] } {
  const ownBrands = new Set<string>();
  const data = rows.map((row) => {
    const own = ownIikoIds === null || ownIikoIds.includes(row.restaurant_group_id);
    if (own && ownIikoIds !== null) ownBrands.add(row.department_id);
    const out = { name: row.name, rank: row.rank, own } as MaskedRow<K>;
    for (const key of valueKeys) {
      (out as Record<K, number | null>)[key] = own ? row[key] : null;
    }
    return out;
  });
  return { data, total: rows.length, own_brands: [...ownBrands] };
}
