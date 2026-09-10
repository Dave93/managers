import { sql, type SQL } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TerminalScope = { ids: string[]; restrict: boolean };

// The dashboard filter speaks in managers terminal uuids, and so does
// cash_shifts.terminal_id (credentials iiko_id is 1:1 with terminals), so no
// brand pairing is needed here, unlike stoplist. A restricted user can only
// narrow their own set, never widen it.
export function resolveTerminalScope(
  terminalsParam: string | undefined,
  userTerminals: string[] | undefined
): TerminalScope {
  const wanted = terminalsParam
    ? terminalsParam.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s))
    : null;
  const own = Array.isArray(userTerminals) && userTerminals.length > 0 ? userTerminals : null;
  if (!terminalsParam && !own) return { ids: [], restrict: false };
  if (wanted && own) return { ids: wanted.filter((id) => own.includes(id)), restrict: true };
  return { ids: wanted ?? own ?? [], restrict: true };
}

// Rows without a terminal (unmapped point of sale) only show up for an
// unrestricted request. An empty restricted scope must match nothing.
export function scopeFilter(scope: TerminalScope): SQL {
  if (!scope.restrict) return sql``;
  if (scope.ids.length === 0) return sql`AND false`;
  return sql`AND cs.terminal_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(scope.ids)}::jsonb)::uuid)`;
}
