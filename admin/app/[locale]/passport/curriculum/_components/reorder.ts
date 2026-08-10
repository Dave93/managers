// Drag-sort planning and persistence, kept as pure functions with no React,
// no Eden and no query-client in scope — so they can be exercised directly.
//
// WHY THIS FILE EXISTS: the first version of this logic renumbered the moved
// array (`sort = i`) BEFORE computing which rows had changed, so the
// "did this row move" predicate compared `i` against a value that had just
// been set to `i`. It was false for every element, the changed set was always
// empty, no PUT was ever issued, and — because nothing threw — the success
// path ran and refetched the server order, snapping the row back with no
// message. The operator saw a drag that silently undid itself.
//
// The order below is the fix and must stay in this order:
//   1. move            (rows still carry their ORIGINAL sort)
//   2. diff  -> changed (compare original sort against the new index)
//   3. renumber -> next (only now is sort overwritten, for the optimistic cache)

import { arrayMove } from "@dnd-kit/sortable";

export interface SortAssignment {
  id: string;
  sort: number;
}

export interface ReorderPlan<T> {
  /** The list with `sort` renumbered 0..n-1 — for the optimistic cache write. */
  next: T[];
  /** Only the rows whose position actually changed — what gets PUT. */
  changed: SortAssignment[];
}

export function planReorder<T extends { id: string; sort: number }>(
  ordered: T[],
  from: number,
  to: number
): ReorderPlan<T> {
  const moved = arrayMove(ordered, from, to);

  // Step 2 BEFORE step 3: `moved[i].sort` is still the row's pre-drag value.
  const changed: SortAssignment[] = [];
  moved.forEach((row, i) => {
    if (row.sort !== i) changed.push({ id: row.id, sort: i });
  });

  const next = moved.map((row, i) => ({ ...row, sort: i }));
  return { next, changed };
}

/**
 * Writes the assignments one at a time (a reorder normally touches 2-3 rows)
 * and stops at the first refusal by throwing, so the caller's onError branch
 * runs: rolling back to the server order and telling the operator.
 *
 * `put` and `describeError` are injected rather than imported so this stays
 * free of the Eden/React import chain.
 */
export async function persistSortAssignments(
  changed: SortAssignment[],
  put: (id: string, sort: number) => Promise<{ error: any }>,
  describeError: (error: any) => string
): Promise<number> {
  for (const row of changed) {
    const { error } = await put(row.id, row.sort);
    if (error) throw new Error(describeError(error));
  }
  return changed.length;
}
